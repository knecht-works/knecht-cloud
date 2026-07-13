import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { execa } from 'execa'
import { z } from 'zod'
import { db, schema } from '../db'
import type { Project, Run } from '../db/schema'
import { commitAll, createBranch, pushBranch } from '../daemon/git'
import { appendLog } from '../daemon/runner'
import { verifyBridgeToken } from '../utils/agent-bridge'
import { getProject, getRun } from '../utils/entities'
import { createPullRequest, getBotIdentity, getInstallationToken } from '../utils/github-app'
import { runWorktreeDir } from '../utils/storage'

// POST /agent-bridge → the agent's git tools. The `knecht-git` CLI baked into
// the sandbox image calls this with the per-run token injected as an env var
// (server/utils/agent-bridge.ts); every op executes HOST-side against that
// run's worktree with the exact same code the workflow git steps use, so no
// repo credential ever enters the sandbox. Outside /api on purpose: the
// session gate (server/middleware/auth.ts) skips non-API paths, and this
// route authenticates with its own token instead.
//
// Guardrails: the token scopes everything to one run; pushes only ever target
// a non-default branch; every op is appended to the run log, so the agent's
// git activity is auditable in the dashboard.

const bodySchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('status') }),
  z.object({ op: z.literal('diff'), paths: z.array(z.string()).optional() }),
  z.object({ op: z.literal('branch'), name: z.string().min(1) }),
  z.object({ op: z.literal('commit'), message: z.string().min(1), paths: z.array(z.string()).optional() }),
  z.object({ op: z.literal('push') }),
  z.object({ op: z.literal('open-pr'), title: z.string().min(1), body: z.string().optional() }),
])

// Replies are plain text: the CLI prints the body verbatim to the agent, and
// a non-2xx status makes it exit non-zero. No JSON parsing in the sandbox.
function reply(event: H3Event, code: number, text: string): string {
  setResponseStatus(event, code)
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return text.endsWith('\n') ? text : `${text}\n`
}

// How much diff/status output travels back to the agent. Large diffs are
// truncated with a pointer to narrow via paths.
const MAX_OUTPUT = 48 * 1024

export default defineEventHandler(async (event) => {
  const runId = Number(getHeader(event, 'x-knecht-run-id') ?? '')
  const token = getHeader(event, 'x-knecht-token') ?? ''
  if (!Number.isInteger(runId) || runId <= 0 || !verifyBridgeToken(runId, token)) {
    return reply(event, 401, 'invalid bridge credentials')
  }

  const run = getRun(runId)
  const project = run && getProject(run.projectId)
  if (!run || !project) return reply(event, 404, 'run not found')

  const dir = runWorktreeDir(runId)
  if (!existsSync(join(dir, '.git'))) {
    return reply(event, 409, 'the run has no checkout (environment torn down)')
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    return reply(event, 400, `invalid request: ${parsed.error.issues.map(i => i.message).join('; ')}`)
  }
  const body = parsed.data

  try {
    switch (body.op) {
      case 'status': {
        const { stdout } = await execa('git', ['-C', dir, 'status', '--porcelain=v1', '--branch'])
        return reply(event, 200, stdout.trim() || 'clean')
      }
      case 'diff': {
        const args = ['-C', dir, 'diff', 'HEAD']
        if (body.paths?.length) args.push('--', ...body.paths)
        const { stdout } = await execa('git', args, { maxBuffer: 64 * 1024 * 1024 })
        const text = stdout.trim() || 'no changes against HEAD (untracked files do not show here, check status)'
        return reply(event, 200, cap(text))
      }
      case 'branch': {
        if (body.name === project.defaultBranch) {
          return reply(event, 400, `refusing to work directly on the default branch '${project.defaultBranch}', pick another name`)
        }
        await execa('git', ['check-ref-format', '--branch', body.name]).catch(() => {
          throw new BridgeError(`'${body.name}' is not a valid branch name`)
        })
        await createBranch(dir, body.name)
        db.update(schema.runs).set({ branch: body.name }).where(eq(schema.runs.id, runId)).run()
        appendLog(runId, `\nagent-git: created branch ${body.name}\n`)
        return reply(event, 200, `on new branch ${body.name}`)
      }
      case 'commit': {
        const sha = await commitAll(dir, body.message, {
          identity: await getBotIdentity(),
          paths: body.paths,
        })
        if (!sha) return reply(event, 200, 'nothing to commit')
        appendLog(runId, `\nagent-git: committed ${sha.slice(0, 8)} (${firstLine(body.message)})\n`)
        return reply(event, 200, `committed ${sha}`)
      }
      case 'push': {
        const branch = pushableBranch(run, project)
        const ghToken = await getInstallationToken(project.owner, project.name)
        await pushBranch(dir, branch, ghToken)
        appendLog(runId, `\nagent-git: pushed ${branch}\n`)
        return reply(event, 200, `pushed ${branch} to origin`)
      }
      case 'open-pr': {
        const branch = pushableBranch(run, project)
        const ghToken = await getInstallationToken(project.owner, project.name)
        await pushBranch(dir, branch, ghToken)
        const pr = await createPullRequest(project.owner, project.name, {
          title: body.title,
          body: body.body ?? '',
          head: branch,
          base: project.defaultBranch,
        })
        if (!pr) return reply(event, 200, 'no commits on the branch, nothing to open a PR for')
        db.update(schema.runs).set({ prUrl: pr.url }).where(eq(schema.runs.id, runId)).run()
        appendLog(runId, `\nagent-git: opened PR #${pr.number}: ${pr.url}\n`)
        return reply(event, 200, `opened PR #${pr.number}: ${pr.url}`)
      }
    }
  }
  catch (e) {
    const message = e instanceof BridgeError ? e.message : `git operation failed: ${(e as Error).message}`
    return reply(event, e instanceof BridgeError ? 400 : 500, message)
  }
})

class BridgeError extends Error {}

// The branch a push may target: the run's branch, and never the project's
// default branch. A plain "boot + ai" run starts with branch = default, so the
// agent is pointed at creating a work branch first. Throws (never silently
// passes a refused branch through) so the catch turns it into a 400.
function pushableBranch(run: Run, project: Project): string {
  if (!run.branch || run.branch === project.defaultBranch) {
    throw new BridgeError(`refusing to push to the default branch '${project.defaultBranch}': create a work branch first (op: branch)`)
  }
  return run.branch
}

function cap(text: string): string {
  if (text.length <= MAX_OUTPUT) return text
  return `${text.slice(0, MAX_OUTPUT)}\n... truncated (${text.length} bytes total), narrow with paths`
}

function firstLine(message: string): string {
  return message.split('\n', 1)[0] ?? message
}
