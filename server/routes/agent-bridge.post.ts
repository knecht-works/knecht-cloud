import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { z } from 'zod'
import type { Session } from '#server/db/schema'
import { currentBranch, pushBranch } from '#server/daemon/git'
import { sessionSandbox } from '#server/daemon/session-sandbox'
import { getIntegration, type Integration } from '#server/integrations'
import { addressee, applyLabels, moveToStatus } from '#server/integrations/capabilities'
import { verifyBridgeToken } from '#server/utils/agent-bridge'
import { emitFollowup } from '#server/utils/transcript'
import { gitProvider } from '#server/git'
import { withPreviewFooter } from '#server/utils/origin'
import { attachPullRequest, describeObject, primaryObject, recordAgentReply, sessionObjects, withSessionLinks, workObject, type SessionObject } from '#server/utils/sessions'
import { ticketFetched } from '#server/utils/object-freshness'
import { writeObjectSnapshot } from '#server/utils/object-snapshot'
import { sessionCheckoutDir } from '#server/utils/storage'
import { getProject } from '#server/stores/projects'
import { getWorkflowRow } from '#server/stores/workflows'
import { getSessionRow, updateSession } from '#server/stores/sessions'
import { createFollowup, getRunningFollowup, queuedAgentFollowup } from '#server/stores/followups'
import { latestSessionRun, getRunningSessionRun, updateRun, appendRunLog } from '#server/stores/runs'
import { setResponseStatus, setHeader, defineEventHandler, getHeader, readBody } from 'h3'

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
//   - `context` (knecht-object): the live state of the session's object, or
//     of a linked one by key, for the agent to read before it works on a mention.
//   - `comment` (knecht-reply), `label` (knecht-label), `status`
//     (knecht-status): act on a session object (`on`, else where the work came
//     from, the ticket for status) through the capabilities
//     of its integration (ADR 0007). Object sessions only; a workflow can opt
//     its runs out (workflows.repliesEnabled). The bridge is where the
//     boundary is enforced: a raw provider token could not be narrowed to
//     "comment, label, transition, nothing else".
//   - `preview` (knecht-preview): queues an agent follow-up that boots the
//     session's preview and then continues the agent's work. The boot
//     replaces the workspace the agent runs in, so it cannot happen mid-turn.
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
  z.object({ op: z.literal('comment'), body: z.string().min(1), newThread: z.boolean().optional(), on: z.string().min(1).optional() }),
  z.object({ op: z.literal('label'), add: z.array(z.string().min(1)).optional(), remove: z.array(z.string().min(1)).optional(), on: z.string().min(1).optional() }),
  z.object({ op: z.literal('status'), status: z.string().min(1), on: z.string().min(1).optional() }),
  z.object({ op: z.literal('context'), key: z.string().min(1).optional() }),
  z.object({ op: z.literal('preview'), task: z.string().optional() }),
])

// Replies are plain text: the CLI prints the body verbatim to the agent, and
// a non-2xx status makes it exit non-zero. No JSON parsing in the sandbox.
function reply(event: H3Event, code: number, text: string): string {
  setResponseStatus(event, code)
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return text.endsWith('\n') ? text : `${text}\n`
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

  // Bridge activity lands in the log of the run doing the work, else the session's newest run:
  // a review the agent's own PR queued must not get the log of the run that opened it.
  const run = getRunningSessionRun(sessionId) ?? latestSessionRun(sessionId)
  const log = (text: string) => {
    if (run) appendRunLog(run.id, text)
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    return reply(event, 400, `invalid request: ${parsed.error.issues.map(i => i.message).join('; ')}`)
  }
  const body = parsed.data

  try {
    switch (body.op) {
      case 'credential': {
        const { token } = await gitProvider(project).credentials(project)
        log(`\nagent-git: issued a repo credential to in-sandbox git\n`)
        return reply(event, 200, token)
      }
      case 'context': {
        const { integration, object } = requireObject(session, 'primary')
        const target = body.key ? integration.objects.find?.(project, body.key) : object
        if (!target) {
          throw new BridgeError(integration.objects.find
            ? `${body.key} is not in a ${integration.name} project linked to this Knecht project`
            : `loading another object by key is not supported for ${integration.name} yet`)
        }
        return reply(event, 200, await viaIntegration(async () => {
          const context = await integration.objects.context(project, target)
          const fetchedAt = new Date()
          const index = await writeObjectSnapshot(sessionSandbox(sessionId, log), context, fetchedAt)
          if (target === object) ticketFetched(sessionId, fetchedAt)
          return index
        }))
      }
      case 'comment': {
        const { integration, object, label, isWork } = requireObject(session, 'work', body.on)
        requireRepliesEnabled(sessionId)
        const followup = getRunningFollowup(sessionId)
        // Whoever asked lives on the object the work came from; on another object nobody is addressed.
        const target = isWork ? followup?.replyTo ?? addressee(getRunningSessionRun(sessionId)?.actor) : null
        // Still addressed to whoever asked, only no longer under their comment.
        const replyTo = body.newThread && target ? { ...target, thread: null } : target
        const comment = await viaIntegration(() => integration.capabilities.comment(project, object, withSessionLinks(body.body, sessionId, object), replyTo))
        if (isWork) recordAgentReply(sessionId)
        log(`\nagent-reply: commented on ${label}\n`)
        return reply(event, 200, `posted the reply on ${label}${comment.url ? `: ${comment.url}` : ''}`)
      }
      case 'label': {
        const { integration, object, label } = requireObject(session, 'work', body.on)
        requireRepliesEnabled(sessionId)
        const did = await viaIntegration(() => applyLabels(integration, project, object, body.add ?? [], body.remove ?? []))
        log(`\nagent-label: ${did} on ${label}\n`)
        return reply(event, 200, `${did} on ${label}`)
      }
      case 'status': {
        const { integration, object, label } = requireObject(session, 'primary', body.on)
        requireRepliesEnabled(sessionId)
        const did = await viaIntegration(() => moveToStatus(integration, project, object, body.status))
        log(`\nagent-status: ${did} on ${label}\n`)
        return reply(event, 200, `${did} on ${label}`)
      }
      case 'preview': {
        if (session.tier === 'preview') return reply(event, 200, 'this session already has a preview: `ddev describe` shows it')
        const followup = getRunningFollowup(sessionId)
        if (!followup) throw new BridgeError('knecht-preview works in follow-ups and mentions; a workflow boots its preview with a boot step')
        // The turn after a boot that failed must not ask again, or it would loop.
        if (followup.origin === 'agent') throw new BridgeError('the preview boot did not succeed: continue without a preview and say so')
        if (!queuedAgentFollowup(sessionId)) {
          const next = createFollowup({
            sessionId,
            runId: followup.runId,
            prompt: body.task?.trim() ?? '',
            model: followup.model,
            requestedBy: followup.requestedBy,
            objectId: followup.objectId,
            origin: 'agent',
            replyTo: followup.replyTo,
          })
          emitFollowup(next.id)
        }
        log(`\nagent-preview: queued a preview boot\n`)
        return reply(event, 200, 'queued a preview boot. Booting replaces this sandbox, so do not reply on the thread yet: finish your turn now with a short note on what you will check. Knecht boots the preview and then continues this session in a new turn')
      }
      case 'open-pr': {
        const sandbox = sessionSandbox(sessionId, log)
        const branch = await currentBranch(sandbox)
        if (branch === 'HEAD') {
          throw new BridgeError('refusing to open a PR from a detached HEAD: check out a work branch first (git checkout -b <name>)')
        }
        if (branch === project.defaultBranch) {
          throw new BridgeError(`refusing to open a PR from the default branch '${project.defaultBranch}': create a work branch first (git checkout -b <name>)`)
        }
        const git = gitProvider(project)
        await pushBranch(sandbox, branch, await git.credentials(project))
        const pr = await git.createPullRequest(project, {
          title: body.title,
          body: withPreviewFooter(body.body ?? '', sessionId),
          head: branch,
          base: project.defaultBranch,
        })
        if (!pr) return reply(event, 200, 'no commits on the branch, nothing to open a PR for')
        updateSession(sessionId, { branch })
        attachPullRequest(session, project, pr, body.title)
        if (run) {
          updateRun(run.id, { branch, prUrl: pr.url })
        }
        const did = pr.existing ? 'pushed to existing' : 'opened'
        log(`\nagent-git: ${did} PR #${pr.number}: ${pr.url}\n`)
        return reply(event, 200, `${did} PR #${pr.number}: ${pr.url}`)
      }
    }
  }
  catch (e) {
    const message = e instanceof BridgeError ? e.message : `git operation failed: ${(e as Error).message}`
    return reply(event, e instanceof BridgeError ? 400 : 500, message)
  }
})

class BridgeError extends Error {}

// Replies go where the running work came from; the ticket (status, context) is the primary object.
function currentObject(sessionId: number, of: 'work' | 'primary'): SessionObject | null {
  if (of === 'primary') return primaryObject(sessionId)
  const work = getRunningFollowup(sessionId) ?? getRunningSessionRun(sessionId)
  return workObject(sessionId, work?.objectId)
}

// The object, or a clear refusal: the reply ops only exist on
// sessions that belong to a ticket, issue or PR.
function requireObject(session: Session, of: 'work' | 'primary', key?: string): { integration: Integration, object: SessionObject, label: string, isWork: boolean } {
  const work = currentObject(session.id, of)
  if (!key && of === 'work') requireTargetFromDashboard(session.id)
  const object = key ? objectByKey(session.id, key) : work
  if (!object) {
    throw new BridgeError('this session does not belong to a ticket, issue or pull request, so there is no thread to post on')
  }
  const isWork = work?.integration === object.integration && work.key === object.key
  return { integration: getIntegration(object.integration), object, label: describeObject(object), isWork }
}

// A dashboard message is about the whole session, so no object is the obvious place to post.
function requireTargetFromDashboard(sessionId: number): void {
  const followup = getRunningFollowup(sessionId)
  const fromDashboard = followup?.origin === 'dashboard' || (followup?.origin === 'agent' && !followup.replyTo)
  if (!fromDashboard) return
  const objects = sessionObjects(sessionId)
  if (objects.length > 1) {
    throw new BridgeError(`this task came from the dashboard and the session holds several objects: pass --on <KEY> with one of: ${objects.map(o => o.key).join(', ')}`)
  }
}

function objectByKey(sessionId: number, key: string): SessionObject {
  const objects = sessionObjects(sessionId)
  const wanted = key.replace(/^#/, '').toLowerCase()
  const object = objects.find(o => o.key.toLowerCase() === wanted)
  if (!object) {
    throw new BridgeError(`${key} is not part of this session. Its objects: ${objects.map(o => o.key).join(', ') || 'none'}`)
  }
  return object
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
  const running = getRunningSessionRun(sessionId)
  if (!running?.workflowId) return
  const workflow = getWorkflowRow(running.workflowId)
  if (workflow && !workflow.repliesEnabled) {
    throw new BridgeError('replying on the thread is disabled for this workflow (workflow settings, Advanced)')
  }
}
