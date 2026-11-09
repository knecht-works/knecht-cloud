import type { Project, Session } from '../db/schema'
import { dispatchRuns } from '../daemon/dispatcher'
import type { Integration, ReplyTarget, WebhookComment } from '../integrations'
import { emptyInputs } from './inputs'
import { resolveSession, sessionHasActiveWork } from './sessions'
import { emitFollowup } from './transcript'
import { appendRunLog, createRun } from '../stores/runs'
import { getWorkflowRow } from '../stores/workflows'
import { ensureStepIds, type Step } from '../../shared/utils/workflow'
import { createFollowup } from '../stores/followups'

export async function handleMention(integration: Integration, project: Project, comment: WebhookComment): Promise<string> {
  if (comment.fromSelf) return 'ignored (comment by Knecht itself)'
  if (!comment.body) return 'ignored (empty comment)'
  if (!comment.mentionsKnecht) return 'ignored (no mention)'
  if (!project.mentionsEnabled) return 'ignored (mentions disabled for project)'
  if (!integration.mentions.allowsAuthor(comment.author)) return `ignored (${comment.author.name} is not an instance member)`

  const { object } = comment
  void integration.mentions.acknowledge?.(project, comment).catch(() => {})

  const session = resolveSession(project, object, null)
  const replyTo: ReplyTarget = { thread: comment.thread ?? null, person: comment.author }

  if (session.envState === 'down' && !sessionHasActiveWork(session.id)) {
    const preview = project.mentionPreview && !!project.bootCommands.trim()
    const starterRow = project.starterWorkflowId ? getWorkflowRow(project.starterWorkflowId) : undefined
    const starter = starterRow?.publishedAt ? starterRow : undefined
    const bootStep: Step[] = preview ? [{ type: 'ddev-start', id: 'mention-preview' }] : []
    const run = createRun({
      projectId: project.id,
      sessionId: session.id,
      workflow: starter?.name ?? (preview ? 'Boot preview' : 'Checkout'),
      workflowId: starter?.id ?? null,
      trigger: 'mention',
      branch: session.branch ?? project.defaultBranch,
      inputs: emptyInputs('mention'),
      steps: [...bootStep, ...ensureStepIds(starter?.steps ?? [])],
    })
    if (starterRow && !starter) {
      appendRunLog(run.id, `Skipped the setup workflow '${starterRow.name}': it is not published.\n`)
    }
    queueMentionRun(project, session, comment.body, replyTo)
    dispatchRuns()
    return `queued setup run ${run.id} + mention run on session ${session.id}`
  }

  const runId = queueMentionRun(project, session, comment.body, replyTo)
  dispatchRuns()
  return `queued mention run ${runId} on session ${session.id}`
}

function queueMentionRun(project: Project, session: Session, prompt: string, replyTo: ReplyTarget): number {
  const runId = createRun({
    projectId: project.id,
    sessionId: session.id,
    workflow: 'Mention',
    kind: 'mention',
    trigger: 'mention',
    branch: session.branch ?? project.defaultBranch,
    actor: replyTo.person,
  }).id
  const followup = createFollowup({
    sessionId: session.id,
    runId,
    prompt,
    requestedBy: replyTo.person.name,
    replyTo,
    origin: 'mention',
  })
  emitFollowup(followup.id)
  return runId
}
