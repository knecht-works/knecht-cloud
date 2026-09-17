import { join } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Followup, Project, Run, Session } from '../db/schema'
import { compactAgentSession, handoverPreamble, runFollowupPrompt } from '../workflows/actions/ai'
import type { ActionRuntime } from '../workflows/actions'
import { createContext } from '../workflows/context'
import { getProject, getRun, getSessionRow } from '../utils/entities'
import { getIntegration } from '../integrations'
import { sessionCheckoutDir } from '../utils/storage'
import { agentRepliedSince, describeObject, sessionObject, withSessionLinks } from '../utils/sessions'
import { transcriptSink } from '../utils/agent-items'
import { emitFollowup } from '../utils/transcript'
import { notice } from './agent'
import { currentBranch } from './git'
import { copyIntoSandbox, spawnInSandbox, streamInSandbox, WEB_PROJECT_DIR } from './sandbox'
import { ensureEnvUp, reviveEnv } from './envs'
import { COMPACT_COMMAND } from '../../shared/utils/followup'
import { followupAttachmentsDir, SANDBOX_ATTACHMENTS_DIR, sandboxAttachmentPath } from '../utils/attachments'

const controllers = new Map<number, AbortController>()

export function cancelFollowup(sessionId: number): boolean {
  const controller = controllers.get(sessionId)
  if (!controller) return false
  controller.abort()
  return true
}

export function hasActiveFollowup(sessionId: number): boolean {
  const row = db
    .select({ id: schema.followups.id })
    .from(schema.followups)
    .where(and(
      eq(schema.followups.sessionId, sessionId),
      inArray(schema.followups.status, ['queued', 'running']),
    ))
    .get()
  return Boolean(row)
}

// Claim-first: the fast lane and the dispatcher can both call this without double-running one.
export async function startFollowup(followupId: number): Promise<void> {
  try {
    const claimed = db.update(schema.followups)
      .set({ status: 'running', startedAt: new Date() })
      .where(and(eq(schema.followups.id, followupId), eq(schema.followups.status, 'queued')))
      .run()
    if (!claimed.changes) return
    emitFollowup(followupId)

    const followup = db.select().from(schema.followups).where(eq(schema.followups.id, followupId)).get()
    const session = followup && getSessionRow(followup.sessionId)
    const run = followup && getRun(followup.runId)
    const project = session && getProject(session.projectId)
    if (!followup || !session || !run || !project) {
      if (followup) finishFollowup(followupId, 'failed', 'Session or project no longer exists')
      return
    }

    // The runner never touches a mention's run row, so its lifecycle is mirrored here.
    const mirrorsRun = followup.origin === 'mention' && run.kind === 'mention'
    if (mirrorsRun) {
      db.update(schema.runs)
        .set({ status: 'running', startedAt: new Date() })
        .where(and(eq(schema.runs.id, run.id), eq(schema.runs.status, 'queued')))
        .run()
    }

    const controller = new AbortController()
    controllers.set(session.id, controller)
    try {
      const reply = await execFollowup(followup, session, run, project, controller)
      finishFollowup(followupId, 'success')
      if (mirrorsRun) finishMentionRun(run.id, 'success')
      await postMentionReply(followup, session, project, reply)
    }
    catch (e) {
      const cancelled = controller.signal.aborted
      finishFollowup(followupId, 'failed', cancelled ? 'Cancelled' : (e as Error).message)
      if (mirrorsRun) finishMentionRun(run.id, cancelled ? 'cancelled' : 'failed')
      if (!cancelled) {
        await postMentionReply(followup, session, project, `I could not finish this: ${(e as Error).message}`)
      }
    }
    finally {
      controllers.delete(session.id)
    }
  }
  catch (e) {
    finishFollowup(followupId, 'failed', (e as Error).message)
  }
}

async function execFollowup(followup: Followup, session: Session, run: Run, project: Project, controller: AbortController): Promise<string> {
  await reviveEnv(session.id)

  // A follow-up has no log segment: everything it produces is a transcript item.
  const sink = transcriptSink(session.id, followup.id)
  const log = (text: string) => {
    if (text.trim()) sink.item(notice(text.trim()))
  }

  const rt: ActionRuntime = {
    runId: run.id,
    sessionId: session.id,
    project,
    checkoutDir: sessionCheckoutDir(session.id),
    ctx: createContext(run.id, project, run.inputs ?? {}),
    log,
    signal: controller.signal,
    sandbox: {
      projectDir: WEB_PROJECT_DIR,
      ensureUp: () => ensureEnvUp(session.id),
      stream: (command, opts) => streamInSandbox(session.id, command, () => {}, opts?.env, controller.signal),
      spawn: (command, opts) => spawnInSandbox(session.id, command, opts?.env),
      copyIn: (hostPath, sandboxPath) => copyIntoSandbox(session.id, hostPath, sandboxPath),
    },
  }

  if (followup.prompt === COMPACT_COMMAND) return compactAgentSession(rt, sink, followup.model)
  if (followup.attachments.length) await stageAttachments(rt, followup)
  const reply = await runFollowupPrompt(rt, followupMessage(followup, session), sink, followup.model)
  if (session.agentHandover) {
    db.update(schema.sessions).set({ agentHandover: null }).where(eq(schema.sessions.id, session.id)).run()
  }
  await syncSessionBranch(session.id, run.id, rt)
  return reply
}

async function postMentionReply(followup: Followup, session: Session, project: Project, text: string): Promise<void> {
  const object = sessionObject(session)
  if (followup.origin !== 'mention' || !object) return
  if (agentRepliedSince(session.id, followup.startedAt ?? followup.createdAt)) return
  try {
    await getIntegration(object.integration).capabilities.comment(project, object, withSessionLinks(text, session.id))
  }
  catch (e) {
    transcriptSink(session.id, followup.id).item(notice(`Could not post the reply on the thread: ${(e as Error).message}`))
  }
}

// docker cp needs the target directory; ensureUp ran already, so the container is there.
async function stageAttachments(rt: ActionRuntime, followup: Followup): Promise<void> {
  await rt.sandbox.ensureUp()
  await rt.sandbox.stream(['mkdir', '-p', `${SANDBOX_ATTACHMENTS_DIR}/${followup.id}`])
  for (const a of followup.attachments) {
    await rt.sandbox.copyIn(join(followupAttachmentsDir(followup.id), a.name), sandboxAttachmentPath(followup.id, a.name))
  }
}

// Without the header the agent reads a follow-up as an output-contract correction and does nothing.
function followupMessage(followup: Followup, session: Session): string {
  const publish = 'Publishing: if this session already has an open pull request, commit your changes (in logical chunks with proper messages) and push when you are done; never open a second PR. Otherwise leave your changes in the working tree for review in the preview, unless the request above asks you to commit, push or open a PR.'
  const object = followup.origin === 'mention' ? sessionObject(session) : null
  // A mention rarely repeats the ticket; the state stays out of the prompt and is read on demand.
  const thread = object ? `This session belongs to ${describeObject(object)}; run \`knecht-object\` for its current state, comments included.\n\n` : ''
  const attached = followup.attachments.length
    ? `\n\nThe user attached these files; they are in the sandbox, read them as needed:\n${followup.attachments.map(a => `- ${sandboxAttachmentPath(followup.id, a.name)} (${a.type || 'unknown type'}, ${Math.max(1, Math.round(a.size / 1024))} KB)`).join('\n')}`
    : ''
  const handover = session.agentHandover ? handoverPreamble(session.agentHandover) : ''
  return `${handover}${thread}A user sent this follow-up request. It is a new instruction, not a schema correction: act on it now. Any earlier output contract does not apply to this message.\n\n${followup.prompt}${attached}\n\n${publish}`
}

async function syncSessionBranch(sessionId: number, runId: number, rt: ActionRuntime): Promise<void> {
  try {
    const branch = await currentBranch(rt.checkoutDir)
    // 'HEAD' is a detached checkout, not a branch name.
    if (branch !== rt.project.defaultBranch && branch !== 'HEAD') {
      db.update(schema.sessions).set({ branch }).where(eq(schema.sessions.id, sessionId)).run()
      db.update(schema.runs).set({ branch }).where(eq(schema.runs.id, runId)).run()
    }
  }
  catch {
    // No checkout, no sync.
  }
}

// Guarded so a user cancel, which flips the row first, is never overwritten.
function finishMentionRun(runId: number, status: 'success' | 'failed' | 'cancelled'): void {
  db.update(schema.runs)
    .set({ status, finishedAt: new Date() })
    .where(and(eq(schema.runs.id, runId), inArray(schema.runs.status, ['queued', 'running'])))
    .run()
}

// Mention anchor runs go with their follow-ups: nothing else moves those rows out of queued/running.
export function cancelFollowupWork(sessionId: number, runId?: number): number {
  const flipped = db.update(schema.followups)
    .set({ status: 'failed', error: 'Cancelled', finishedAt: new Date() })
    .where(and(
      runId === undefined ? eq(schema.followups.sessionId, sessionId) : eq(schema.followups.runId, runId),
      inArray(schema.followups.status, ['queued', 'running']),
    ))
    .returning({ id: schema.followups.id })
    .all()
  for (const { id } of flipped) emitFollowup(id)
  db.update(schema.runs)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(and(
      runId === undefined ? eq(schema.runs.sessionId, sessionId) : eq(schema.runs.id, runId),
      eq(schema.runs.kind, 'mention'),
      inArray(schema.runs.status, ['queued', 'running']),
    ))
    .run()
  cancelFollowup(sessionId)
  return flipped.length
}

function finishFollowup(id: number, status: 'success' | 'failed', error?: string): void {
  db.update(schema.followups)
    .set({ status, error: error ?? null, finishedAt: new Date() })
    .where(eq(schema.followups.id, id))
    .run()
  emitFollowup(id)
}
