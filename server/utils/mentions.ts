import { db, schema } from '../db'
import type { Project, Session } from '../db/schema'
import { dispatchRuns } from '../daemon/dispatcher'
import type { CommentAuthor, Integration, WebhookComment } from '../integrations'
import { getWorkflowRow } from './entities'
import { emptyInputs } from './inputs'
import { resolveSession, sessionHasActiveWork, type SessionObject } from './sessions'
import { emitFollowup } from './transcript'

export async function handleMention(integration: Integration, project: Project, comment: WebhookComment): Promise<string> {
  if (comment.fromSelf) return 'ignored (comment by Knecht itself)'
  if (!comment.body) return 'ignored (empty comment)'
  if (!comment.mentionsKnecht) return 'ignored (no mention)'
  if (!project.mentionsEnabled) return 'ignored (mentions disabled for project)'
  if (!integration.mentions.allowsAuthor(comment.author)) return `ignored (${comment.author.name} is not an instance member)`

  const { object } = comment
  void integration.mentions.acknowledge?.(project, comment).catch(() => {})

  const session = resolveSession(project, object, null)

  if (session.envState === 'down' && !sessionHasActiveWork(session.id)) {
    const starter = project.starterWorkflowId ? getWorkflowRow(project.starterWorkflowId) : undefined
    if (!starter || !starter.publishedAt) {
      await postHint(integration, project, object, starter ? 'starter-unpublished' : 'no-starter')
      return 'replied with a setup hint (no usable starter workflow)'
    }
    const run = db.insert(schema.runs).values({
      projectId: project.id,
      sessionId: session.id,
      workflow: starter.name,
      workflowId: starter.id,
      trigger: 'mention',
      branch: session.branch ?? project.defaultBranch,
      inputs: emptyInputs('mention'),
    }).returning().get()
    queueMentionRun(project, session, comment.body, comment.author)
    dispatchRuns()
    return `queued starter run ${run.id} + mention run on session ${session.id}`
  }

  const runId = queueMentionRun(project, session, comment.body, comment.author)
  dispatchRuns()
  return `queued mention run ${runId} on session ${session.id}`
}

function queueMentionRun(project: Project, session: Session, prompt: string, author: CommentAuthor): number {
  const runId = db.insert(schema.runs).values({
    projectId: project.id,
    sessionId: session.id,
    workflow: 'Mention',
    kind: 'mention',
    trigger: 'mention',
    branch: session.branch ?? project.defaultBranch,
    actor: author,
  }).returning({ id: schema.runs.id }).get().id
  const followup = db.insert(schema.followups).values({
    sessionId: session.id,
    runId,
    prompt,
    requestedBy: author.name,
    origin: 'mention',
  }).returning({ id: schema.followups.id }).get()
  emitFollowup(followup.id)
  return runId
}

async function postHint(integration: Integration, project: Project, object: SessionObject, reason: 'no-starter' | 'starter-unpublished'): Promise<void> {
  const text = reason === 'no-starter'
    ? 'I can pick this up once the project has a starter workflow: it boots the environment my work runs in. Choose one in the project settings under Mentions, then mention me again.'
    : 'The project\'s starter workflow is not published yet, so I cannot boot an environment for this thread. Publish it, then mention me again.'
  try {
    await integration.capabilities.comment(project, object, text)
  }
  catch (e) {
    console.error(`mention hint reply failed: ${(e as Error).message}`)
  }
}
