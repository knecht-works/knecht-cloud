import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db'
import type { Session } from '../db/schema'
import { currentBranch, pushBranch } from '../daemon/git'
import { appendLog } from '../daemon/runner'
import { getIntegration, type Integration } from '../integrations'
import { applyLabels, moveToStatus } from '../integrations/capabilities'
import { verifyBridgeToken } from '../utils/agent-bridge'
import { getProject, getSessionRow, getWorkflowRow } from '../utils/entities'
import { createPullRequest, getInstallationToken } from '../utils/github-app'
import { withPreviewFooter } from '../utils/origin'
import { describeObject, recordAgentReply, sessionObject, withSessionLinks, type SessionObject } from '../utils/sessions'
import { sessionCheckoutDir } from '../utils/storage'

// POST /agent-bridge → what the in-sandbox agent can NOT do on its own.
// Plain git works inside the sandbox (the session's checkout is a
// self-contained clone, daemon/git.ts), so the bridge is down to a few ops,
// called by the CLIs mounted into the web container:
//   - `credential` (knecht-git): the git credential helper's token source;
//     hands plain git a repo-scoped ~1h installation token for push/fetch.
//   - `open-pr` (knecht-git): pushes the checkout's current branch and opens
//     a pull request (a GitHub API call the sandbox has no other path to),
//     and syncs the session's branch (+ the newest run's branch/prUrl) so
//     the dashboard shows them.
//   - `context` (knecht-object): the live state of the session's object, for
//     the agent to read before it works on a mention.
//   - `comment` (knecht-reply), `label` (knecht-label), `status`
//     (knecht-status): act on the session's object through the capabilities
//     of its integration (ADR 0007). Object sessions only; a workflow can opt
//     its runs out (workflows.repliesEnabled). The bridge is where the
//     boundary is enforced: a raw provider token could not be narrowed to
//     "comment, label, transition, nothing else".
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
  z.object({ op: z.literal('comment'), body: z.string().min(1) }),
  z.object({ op: z.literal('label'), add: z.array(z.string().min(1)).optional(), remove: z.array(z.string().min(1)).optional() }),
  z.object({ op: z.literal('status'), status: z.string().min(1) }),
  z.object({ op: z.literal('context') }),
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

  const session = getSessionRow(sessionId)
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
      case 'context': {
        const { integration, object } = requireObject(session)
        return reply(event, 200, await viaIntegration(() => integration.objects.context(project, object)))
      }
      case 'comment': {
        const { integration, object, label } = requireObject(session)
        requireRepliesEnabled(sessionId)
        const comment = await viaIntegration(() => integration.capabilities.comment(project, object, withSessionLinks(body.body, sessionId)))
        recordAgentReply(sessionId)
        log(`\nagent-reply: commented on ${label}\n`)
        return reply(event, 200, `posted the reply on ${label}${comment.url ? `: ${comment.url}` : ''}`)
      }
      case 'label': {
        const { integration, object, label } = requireObject(session)
        requireRepliesEnabled(sessionId)
        const did = await viaIntegration(() => applyLabels(integration, project, object, body.add ?? [], body.remove ?? []))
        log(`\nagent-label: ${did} on ${label}\n`)
        return reply(event, 200, `${did} on ${label}`)
      }
      case 'status': {
        const { integration, object, label } = requireObject(session)
        requireRepliesEnabled(sessionId)
        const did = await viaIntegration(() => moveToStatus(integration, project, object, body.status))
        log(`\nagent-status: ${did} on ${label}\n`)
        return reply(event, 200, `${did} on ${label}`)
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

// The session's object, or a clear refusal: the reply ops only exist on
// sessions that belong to a ticket, issue or PR.
function requireObject(session: Session): { integration: Integration, object: SessionObject, label: string } {
  const object = sessionObject(session)
  if (!object) {
    throw new BridgeError('this session does not belong to a ticket, issue or pull request, so there is no thread to post on')
  }
  return { integration: getIntegration(object.integration), object, label: describeObject(object) }
}

// A refused or failed provider call is the agent's problem to read, not a server fault.
async function viaIntegration<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  }
  catch (e) {
    throw new BridgeError((e as Error).message)
  }
}

// The workflow-level opt-out (workflows.repliesEnabled): enforced against
// whatever workflow run is executing in the session right now. Follow-ups
// (no running run) always carry the reply tools.
function requireRepliesEnabled(sessionId: number): void {
  const running = db
    .select({ workflowId: schema.runs.workflowId })
    .from(schema.runs)
    .where(and(eq(schema.runs.sessionId, sessionId), eq(schema.runs.status, 'running')))
    .get()
  if (!running?.workflowId) return
  const workflow = getWorkflowRow(running.workflowId)
  if (workflow && !workflow.repliesEnabled) {
    throw new BridgeError('replying on the thread is disabled for this workflow (workflow settings, Advanced)')
  }
}
