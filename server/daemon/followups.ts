import { join } from 'node:path'
import type { Followup, Project, Run, Session } from '#server/db/schema'
import { compactAgentSession, handoverPreamble, notesPreamble, runFollowupPrompt } from '#server/workflows/actions/ai'
import type { ActionRuntime } from '#server/workflows/actions'
import { ddevStartAction } from '#server/workflows/actions/ddev-start'
import { createContext } from '#server/workflows/context'
import { getIntegration } from '#server/integrations'
import { handBackObject, takeObject } from '#server/integrations/assignee'
import { sessionCheckoutDir } from '#server/utils/storage'
import { agentRepliedSince, taskBriefing, workObject, withSessionLinks } from '#server/utils/sessions'
import { transcriptSink } from '#server/utils/agent-items'
import { emitFollowup } from '#server/utils/transcript'
import { notice } from '#server/daemon/agent'
import { currentBranch } from '#server/daemon/git'
import { reviveEnv } from '#server/daemon/envs'
import { sessionSandbox } from '#server/daemon/session-sandbox'
import { COMPACT_COMMAND } from '#shared/utils/followup'
import { followupAttachmentsDir, SANDBOX_ATTACHMENTS_DIR, sandboxAttachmentPath } from '#server/utils/attachments'
import { getProject } from '#server/stores/projects'
import { getSessionRow, updateSession } from '#server/stores/sessions'
import { appendRunLog, getRun, latestWorkflowRun, runLogBytes, updateRun, startQueuedRun, finishActiveRun, cancelActiveMentionRuns } from '#server/stores/runs'
import { createRunStep, updateRunStep } from '#server/stores/run-steps'
import { getFollowup, updateFollowup, claimQueuedFollowup, cancelActiveFollowups, queuedAgentFollowup } from '#server/stores/followups'

const controllers = new Map<number, AbortController>()

export function cancelFollowup(sessionId: number): boolean {
  const controller = controllers.get(sessionId)
  if (!controller) return false
  controller.abort()
  return true
}

export async function startFollowup(followupId: number): Promise<void> {
  try {
    if (!claimQueuedFollowup(followupId)) return
    emitFollowup(followupId)

    const followup = getFollowup(followupId)
    const session = followup && getSessionRow(followup.sessionId)
    const run = followup && getRun(followup.runId)
    const project = session && getProject(session.projectId)
    if (!followup || !session || !run || !project) {
      if (followup) finishFollowup(followupId, 'failed', 'Session or project no longer exists')
      return
    }

    // The runner never touches a mention's run row, so its lifecycle is mirrored here.
    const mirrorsRun = followup.origin !== 'dashboard' && run.kind === 'mention'
    if (mirrorsRun) {
      startQueuedRun(run.id)
    }

    const controller = new AbortController()
    controllers.set(session.id, controller)
    const log = (text: string) => transcriptSink(session.id, followupId).item(notice(text.trim()))
    await takeObject(session, run.id, project, log)
    try {
      const reply = await execFollowup(followup, session, run, project, controller)
      finishFollowup(followupId, 'success')
      if (mirrorsRun && !queuedAgentFollowup(session.id)) finishActiveRun(run.id, 'success')
      await postMentionReply(followup, session, project, reply)
    }
    catch (e) {
      const cancelled = controller.signal.aborted
      finishFollowup(followupId, 'failed', cancelled ? 'Cancelled' : (e as Error).message)
      if (mirrorsRun && !queuedAgentFollowup(session.id)) finishActiveRun(run.id, cancelled ? 'cancelled' : 'failed')
      if (!cancelled) {
        await postMentionReply(followup, session, project, `I could not finish this: ${(e as Error).message}`)
      }
    }
    finally {
      controllers.delete(session.id)
    }
    await handBackObject(session, run.id, project, log)
  }
  catch (e) {
    finishFollowup(followupId, 'failed', (e as Error).message)
  }
}

async function execFollowup(followup: Followup, session: Session, run: Run, project: Project, controller: AbortController): Promise<string> {
  // A follow-up has no log segment: everything it produces is a transcript item.
  const sink = transcriptSink(session.id, followup.id)
  const log = (text: string) => {
    if (text.trim()) sink.item(notice(text.trim()))
  }
  // Only the restore notices: a reboot's ddev output would flood the transcript.
  await reviveEnv(session.id, session.envState === 'archived' ? log : undefined)

  const rt: ActionRuntime = {
    runId: run.id,
    sessionId: session.id,
    project,
    checkoutDir: sessionCheckoutDir(session.id),
    ctx: createContext(run.id, project, run.inputs ?? {}),
    log,
    signal: controller.signal,
    sandbox: sessionSandbox(session.id, () => {}, controller.signal),
  }

  if (followup.prompt === COMPACT_COMMAND) return compactAgentSession(rt, sink, followup.model)
  if (followup.attachments.length) await stageAttachments(rt, followup)
  const boot = followup.origin === 'agent' ? await bootPreview(rt, sink, followup) : null
  const reply = await runFollowupPrompt(rt, boot === null ? followupMessage(followup, session) : continueMessage(followup, session, boot), sink, followup.model)
  if (session.agentHandover || session.agentNotes) {
    updateSession(session.id, { agentHandover: null, agentNotes: null })
  }
  await syncSessionBranch(session.id, run.id, rt)
  return reply
}

// An agent follow-up has a thread to answer only when it continues a mention.
async function postMentionReply(followup: Followup, session: Session, project: Project, text: string): Promise<void> {
  const object = followup.origin === 'mention' || (followup.origin === 'agent' && followup.replyTo) ? workObject(session.id, followup.objectId) : null
  if (!object) return
  if (agentRepliedSince(session.id, followup.startedAt ?? followup.createdAt)) return
  // The agent asked for a preview: the turn after the boot answers the thread.
  if (queuedAgentFollowup(session.id)) return
  try {
    await getIntegration(object.integration).capabilities.comment(project, object, withSessionLinks(text, session.id, object), followup.replyTo)
  }
  catch (e) {
    transcriptSink(session.id, followup.id).item(notice(`Could not post the reply on the thread: ${(e as Error).message}`))
  }
}

// The session log shows the boot like any other: as a step of the run the log streams.
async function bootPreview(rt: ActionRuntime, sink: ReturnType<typeof transcriptSink>, followup: Followup): Promise<string | undefined> {
  const logRun = latestWorkflowRun(followup.sessionId) ?? getRun(followup.runId)!
  const rowId = createRunStep({
    runId: logRun.id,
    stepIndex: logRun.steps?.length ?? 0,
    stepId: `agent-preview-${followup.id}`,
    type: 'ddev-start',
    origin: 'followup',
    params: {},
    logStart: runLogBytes(logRun.id),
    startedAt: new Date(),
  })
  const status = (text: string, state: 'in_progress' | 'completed' | 'failed', output: string | null = null) =>
    sink.item({ key: 'boot-preview', type: 'tool', kind: 'preview', text, status: state, output })
  status('Booting the preview', 'in_progress')
  try {
    await ddevStartAction.run({ type: 'ddev-start' }, { ...rt, log: text => appendRunLog(logRun.id, text) })
    updateRunStep(rowId, { status: 'success', finishedAt: new Date() })
    status('Booted the preview', 'completed')
    return undefined
  }
  catch (e) {
    const message = (e as Error).message
    updateRunStep(rowId, { status: rt.signal.aborted ? 'cancelled' : 'failed', error: message, finishedAt: new Date() })
    status('The preview did not boot', 'failed', message)
    if (rt.signal.aborted) throw e
    return message
  }
}

function continueMessage(followup: Followup, session: Session, bootError: string | undefined): string {
  const thread = taskBriefing(session.id, followup.objectId, followup.requestedBy, !followup.replyTo)
  const booted = bootError === undefined
    ? 'Knecht booted the preview you asked for with knecht-preview. Continue the task you were working on.'
    : `The preview you asked for with knecht-preview did not boot: ${bootError}\nContinue the task without it and say that the preview is missing.`
  const next = followup.prompt ? `\n\nWhat you wanted to do with it: ${followup.prompt}` : ''
  return `${thread}${booted}${next}`
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
  const thread = taskBriefing(session.id, followup.objectId, followup.requestedBy, followup.origin === 'dashboard')
  const attached = followup.attachments.length
    ? `\n\nThe user attached these files; they are in the sandbox, read them as needed:\n${followup.attachments.map(a => `- ${sandboxAttachmentPath(followup.id, a.name)} (${a.type || 'unknown type'}, ${Math.max(1, Math.round(a.size / 1024))} KB)`).join('\n')}`
    : ''
  const handover = session.agentHandover ? handoverPreamble(session.agentHandover) : ''
  const notes = session.agentNotes ? notesPreamble(session.agentNotes) : ''
  const codeOnly = session.tier === 'code' ? 'This is a code session (no database, no running site).\n\n' : ''
  return `${handover}${notes}${thread}${codeOnly}A user sent this follow-up request. It is a new instruction, not a schema correction: act on it now. Any earlier output contract does not apply to this message.\n\n${followup.prompt}${attached}\n\n${publish}`
}

async function syncSessionBranch(sessionId: number, runId: number, rt: ActionRuntime): Promise<void> {
  try {
    const branch = await currentBranch(rt.sandbox)
    // 'HEAD' is a detached checkout, not a branch name.
    if (branch !== rt.project.defaultBranch && branch !== 'HEAD') {
      updateSession(sessionId, { branch })
      updateRun(runId, { branch })
    }
  }
  catch {
    // No checkout, no sync.
  }
}

// Mention anchor runs go with their follow-ups: nothing else moves those rows out of queued/running.
export function cancelFollowupWork(sessionId: number, runId?: number): number {
  const flipped = cancelActiveFollowups(runId === undefined ? { sessionId } : { runId })
  for (const id of flipped) emitFollowup(id)
  cancelActiveMentionRuns(runId === undefined ? { sessionId } : { runId })
  cancelFollowup(sessionId)
  return flipped.length
}

function finishFollowup(id: number, status: 'success' | 'failed', error?: string): void {
  updateFollowup(id, { status, error: error ?? null, finishedAt: new Date() })
  emitFollowup(id)
}
