import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project, Session } from '../db/schema'
import { dispatchRuns } from '../daemon/dispatcher'
import { addCommentReaction, createIssueComment } from './github-app'
import { getWorkflowRow } from './entities'
import { isMember } from './members'
import { resolveSession, sessionHasActiveWork, type SessionObject } from './sessions'
import type { GithubPayload } from './github-webhook'

const MENTION_HANDLE = 'knecht-works'

let cachedSlug: string | null | undefined
function appSlug(): string | null {
  if (cachedSlug !== undefined) return cachedSlug
  cachedSlug = db.select({ slug: schema.githubApp.slug }).from(schema.githubApp).where(eq(schema.githubApp.id, 1)).get()?.slug ?? null
  return cachedSlug
}

function mentionsKnecht(body: string): boolean {
  const handles = [MENTION_HANDLE, appSlug()].filter((h): h is string => !!h)
  return handles.some(h => new RegExp(`@${h}\\b`, 'i').test(body))
}

export async function handleMention(project: Project, payload: GithubPayload): Promise<string> {
  if (payload.action !== 'created') return 'ignored (not a new comment)'

  const body = payload.comment?.body ?? ''
  const author = (payload.comment?.user?.login ?? '').toLowerCase()
  if (!body || !author) return 'ignored (empty comment)'
  // Includes Knecht's own replies: the guaranteed reply would otherwise loop.
  if (payload.comment?.user?.type === 'Bot') return 'ignored (bot comment)'
  if (!mentionsKnecht(body)) return 'ignored (no mention)'
  if (!project.mentionsEnabled) return 'ignored (mentions disabled for project)'
  if (!isMember(author)) return `ignored (@${author} is not an instance member)`

  const issue = payload.issue
  if (typeof issue?.number !== 'number') return 'ignored (no issue number)'
  const object: SessionObject = {
    kind: issue.pull_request ? 'pull_request' : 'issue',
    number: issue.number,
    url: issue.html_url,
    title: issue.title,
  }

  if (typeof payload.comment?.id === 'number') {
    void addCommentReaction(project.owner, project.name, payload.comment.id, 'eyes').catch(() => {})
  }

  const session = resolveSession(project, object, null)

  if (session.envState === 'down' && !sessionHasActiveWork(session.id)) {
    const starter = project.starterWorkflowId ? getWorkflowRow(project.starterWorkflowId) : undefined
    if (!starter || !starter.publishedAt) {
      await postHint(project, object, starter ? 'starter-unpublished' : 'no-starter')
      return 'replied with a setup hint (no usable starter workflow)'
    }
    const run = db.insert(schema.runs).values({
      projectId: project.id,
      sessionId: session.id,
      workflow: starter.name,
      workflowId: starter.id,
      trigger: 'mention',
      branch: session.branch ?? project.defaultBranch,
    }).returning().get()
    queueMentionRun(project, session, body, author)
    dispatchRuns()
    return `queued starter run ${run.id} + mention run on session ${session.id}`
  }

  const runId = queueMentionRun(project, session, body, author)
  dispatchRuns()
  return `queued mention run ${runId} on session ${session.id}`
}

function queueMentionRun(project: Project, session: Session, prompt: string, requestedBy: string): number {
  const runId = db.insert(schema.runs).values({
    projectId: project.id,
    sessionId: session.id,
    workflow: 'Mention',
    kind: 'mention',
    trigger: 'mention',
    branch: session.branch ?? project.defaultBranch,
  }).returning({ id: schema.runs.id }).get().id
  db.insert(schema.followups).values({
    sessionId: session.id,
    runId,
    prompt,
    requestedBy,
    origin: 'mention',
  }).run()
  return runId
}

async function postHint(project: Project, object: SessionObject, reason: 'no-starter' | 'starter-unpublished'): Promise<void> {
  const text = reason === 'no-starter'
    ? 'I can pick this up once the project has a starter workflow: it boots the environment my work runs in. Choose one in the project settings under Mentions, then mention me again.'
    : 'The project\'s starter workflow is not published yet, so I cannot boot an environment for this thread. Publish it, then mention me again.'
  try {
    await createIssueComment(project.owner, project.name, object.number, text)
  }
  catch (e) {
    console.error(`mention hint reply failed: ${(e as Error).message}`)
  }
}
