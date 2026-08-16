import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db'
import { currentBranch, pushBranch } from '../daemon/git'
import { appendLog } from '../daemon/runner'
import { verifyBridgeToken } from '../utils/agent-bridge'
import { getProject, getSession } from '../utils/entities'
import { createPullRequest, getInstallationToken } from '../utils/github-app'
import { withPreviewFooter } from '../utils/origin'
import { sessionCheckoutDir } from '../utils/storage'

// POST /agent-bridge → what in-sandbox git can NOT do on its own. Plain git
// works inside the sandbox (the session's checkout is a self-contained clone,
// daemon/git.ts), so the bridge is down to two ops, both called by the
// `knecht-git` CLI mounted into the web container:
//   - `credential`: the git credential helper's token source; hands plain git
//     a repo-scoped ~1h installation token for push/fetch.
//   - `open-pr`: pushes the checkout's current branch and opens a pull
//     request (a GitHub API call the sandbox has no other path to), and syncs
//     the session's branch (+ the newest run's branch/prUrl) so the
//     dashboard shows them.
// Outside /api on purpose: the session gate (server/middleware/auth.ts) skips
// non-API paths, and this route authenticates with its own per-session token
// (server/utils/agent-bridge.ts) instead. The x-knecht-run-id header carries
// the SESSION id (historical wire name, kept so tokens baked into
// pre-session checkouts stay valid). A sandbox holder can push to any branch
// of the session's repo; branch protection on the repo guards the default
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

// The session's newest run: where bridge activity lands in a log/timeline.
function latestRun(sessionId: number) {
  return db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(eq(schema.runs.sessionId, sessionId))
    .orderBy(desc(schema.runs.id))
    .get()
}

export default defineEventHandler(async (event) => {
  const sessionId = Number(getHeader(event, 'x-knecht-run-id') ?? '')
  const token = getHeader(event, 'x-knecht-token') ?? ''
  if (!Number.isInteger(sessionId) || sessionId <= 0 || !verifyBridgeToken(sessionId, token)) {
    return reply(event, 401, 'invalid bridge credentials')
  }

  const session = getSession(sessionId)
  const project = session && getProject(session.projectId)
  if (!session || !project) return reply(event, 404, 'session not found')

  const dir = sessionCheckoutDir(sessionId)
  if (!existsSync(join(dir, '.git'))) {
    return reply(event, 409, 'the session has no checkout (environment torn down)')
  }

  const run = latestRun(sessionId)
  const log = (text: string) => {
    if (run) appendLog(run.id, text)
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
        log(`\nagent-git: issued a repo credential to in-sandbox git\n`)
        return reply(event, 200, ghToken)
      }
      case 'open-pr': {
        const branch = await currentBranch(dir)
        if (branch === 'HEAD') {
          throw new BridgeError('refusing to open a PR from a detached HEAD: check out a work branch first (git checkout -b <name>)')
        }
        if (branch === project.defaultBranch) {
          throw new BridgeError(`refusing to open a PR from the default branch '${project.defaultBranch}': create a work branch first (git checkout -b <name>)`)
        }
        const ghToken = await getInstallationToken(project.owner, project.name)
        await pushBranch(dir, branch, ghToken)
        const pr = await createPullRequest(project.owner, project.name, {
          title: body.title,
          body: withPreviewFooter(body.body ?? '', sessionId),
          head: branch,
          base: project.defaultBranch,
        })
        if (!pr) return reply(event, 200, 'no commits on the branch, nothing to open a PR for')
        db.update(schema.sessions).set({ branch }).where(eq(schema.sessions.id, sessionId)).run()
        if (run) {
          db.update(schema.runs).set({ branch, prUrl: pr.url }).where(eq(schema.runs.id, run.id)).run()
        }
        log(`\nagent-git: opened PR #${pr.number}: ${pr.url}\n`)
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
