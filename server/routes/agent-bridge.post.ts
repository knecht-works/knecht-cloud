import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db'
import { currentBranch, pushBranch } from '../daemon/git'
import { appendLog } from '../daemon/runner'
import { verifyBridgeToken } from '../utils/agent-bridge'
import { getProject, getRun } from '../utils/entities'
import { createPullRequest, getInstallationToken } from '../utils/github-app'
import { runCheckoutDir } from '../utils/storage'

// POST /agent-bridge → what in-sandbox git can NOT do on its own. Plain git
// works inside the sandbox (the run's checkout is a self-contained clone,
// daemon/git.ts), so the bridge is down to two ops, both called by the
// `knecht-git` CLI mounted into the web container:
//   - `credential`: the git credential helper's token source; hands plain git
//     a repo-scoped ~1h installation token for push/fetch.
//   - `open-pr`: pushes the checkout's current branch and opens a pull
//     request (a GitHub API call the sandbox has no other path to), and syncs
//     runs.branch/prUrl so the dashboard shows them.
// Outside /api on purpose: the session gate (server/middleware/auth.ts) skips
// non-API paths, and this route authenticates with its own per-run token
// (server/utils/agent-bridge.ts) instead. A sandbox holder can push to any
// branch of the run's repo; branch protection on the repo guards the default
// branch.

const bodySchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('credential') }),
  z.object({ op: z.literal('open-pr'), title: z.string().min(1), body: z.string().optional() }),
])

// Replies are plain text: the CLI prints the body verbatim to the agent, and
// a non-2xx status makes it exit non-zero. No JSON parsing in the sandbox.
function reply(event: H3Event, code: number, text: string): string {
  setResponseStatus(event, code)
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return text.endsWith('\n') ? text : `${text}\n`
}

export default defineEventHandler(async (event) => {
  const runId = Number(getHeader(event, 'x-knecht-run-id') ?? '')
  const token = getHeader(event, 'x-knecht-token') ?? ''
  if (!Number.isInteger(runId) || runId <= 0 || !verifyBridgeToken(runId, token)) {
    return reply(event, 401, 'invalid bridge credentials')
  }

  const run = getRun(runId)
  const project = run && getProject(run.projectId)
  if (!run || !project) return reply(event, 404, 'run not found')

  const dir = runCheckoutDir(runId)
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
      case 'credential': {
        const ghToken = await getInstallationToken(project.owner, project.name)
        appendLog(runId, `\nagent-git: issued a repo credential to in-sandbox git\n`)
        return reply(event, 200, ghToken)
      }
      case 'open-pr': {
        const branch = await currentBranch(dir)
        if (branch === project.defaultBranch) {
          throw new BridgeError(`refusing to open a PR from the default branch '${project.defaultBranch}': create a work branch first (git checkout -b <name>)`)
        }
        const ghToken = await getInstallationToken(project.owner, project.name)
        await pushBranch(dir, branch, ghToken)
        const pr = await createPullRequest(project.owner, project.name, {
          title: body.title,
          body: body.body ?? '',
          head: branch,
          base: project.defaultBranch,
        })
        if (!pr) return reply(event, 200, 'no commits on the branch, nothing to open a PR for')
        db.update(schema.runs).set({ branch, prUrl: pr.url }).where(eq(schema.runs.id, runId)).run()
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
