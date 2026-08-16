import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db'
import { currentBranch, pushBranch } from '../daemon/git'
import { appendLog } from '../daemon/runner'
import { verifyBridgeToken } from '../utils/agent-bridge'
import { getProject, getSession, getWorkflowRow } from '../utils/entities'
import { addIssueLabels, createIssueComment, createPullRequest, getInstallationToken, listRepoLabels, removeIssueLabel } from '../utils/github-app'
import { withPreviewFooter } from '../utils/origin'
import { recordAgentReply } from '../utils/sessions'
import { sessionCheckoutDir } from '../utils/storage'

// POST /agent-bridge → what the in-sandbox agent can NOT do on its own.
// Plain git works inside the sandbox (the session's checkout is a
// self-contained clone, daemon/git.ts), so the bridge is down to four ops,
// called by the CLIs mounted into the web container:
//   - `credential` (knecht-git): the git credential helper's token source;
//     hands plain git a repo-scoped ~1h installation token for push/fetch.
//   - `open-pr` (knecht-git): pushes the checkout's current branch and opens
//     a pull request (a GitHub API call the sandbox has no other path to),
//     and syncs the session's branch (+ the newest run's branch/prUrl) so
//     the dashboard shows them.
//   - `comment` (knecht-reply): posts a reply on the session's object (ADR
//     0007). Object sessions only; a workflow can opt its runs out
//     (workflows.repliesEnabled).
//   - `label` (knecht-label): adds EXISTING repo labels to / removes labels
//     from the session's object. Never creates labels, never closes or
//     assigns: the bridge is where that boundary is enforced, a raw GitHub
//     token could not be narrowed like this.
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
      case 'comment': {
        const object = requireObject(session)
        requireRepliesEnabled(sessionId)
        const comment = await createIssueComment(project.owner, project.name, object.number, body.body)
        recordAgentReply(sessionId)
        log(`\nagent-reply: commented on ${object.label}\n`)
        return reply(event, 200, `posted the reply on ${object.label}: ${comment.url}`)
      }
      case 'label': {
        const object = requireObject(session)
        requireRepliesEnabled(sessionId)
        const add = body.add ?? []
        const remove = body.remove ?? []
        if (!add.length && !remove.length) throw new BridgeError('nothing to do: pass labels to add or remove')
        if (add.length) {
          // Only labels that already exist in the repo may be applied: Knecht
          // never invents labels (ADR 0007).
          const existing = new Set(await listRepoLabels(project.owner, project.name))
          const unknown = add.filter(l => !existing.has(l))
          if (unknown.length) {
            throw new BridgeError(`these labels do not exist in the repo and Knecht never creates labels: ${unknown.join(', ')}. Existing labels: ${[...existing].join(', ') || '(none)'}`)
          }
          await addIssueLabels(project.owner, project.name, object.number, add)
        }
        for (const label of remove) {
          await removeIssueLabel(project.owner, project.name, object.number, label)
        }
        const did = [add.length ? `added ${add.join(', ')}` : '', remove.length ? `removed ${remove.join(', ')}` : ''].filter(Boolean).join('; ')
        log(`\nagent-label: ${did} on ${object.label}\n`)
        return reply(event, 200, `${did} on ${object.label}`)
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
// sessions that belong to an issue or PR.
function requireObject(session: { objectKind: string | null, objectNumber: number | null }): { number: number, label: string } {
  if (!session.objectKind || !session.objectNumber) {
    throw new BridgeError('this session does not belong to an issue or pull request, so there is no thread to post on')
  }
  return {
    number: session.objectNumber,
    label: `${session.objectKind === 'issue' ? 'issue' : 'pull request'} #${session.objectNumber}`,
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
    throw new BridgeError('replying on the issue/PR is disabled for this workflow (workflow settings, Advanced)')
  }
}
