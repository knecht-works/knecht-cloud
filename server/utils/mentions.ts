import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project, Session } from '../db/schema'
import { dispatchRuns } from '../daemon/dispatcher'
import { addCommentReaction, createIssueComment } from './github-app'
import { getWorkflowRow } from './entities'
import { isMember } from './members'
import { resolveSession, sessionHasActiveWork, type SessionObject } from './sessions'
import type { GithubPayload } from './github-webhook'

// Mentions (ADR 0007): calling Knecht by its app name in an issue/PR comment
// executes the comment as a follow-up on the commented object's session. The
// comment text is the whole instruction; nothing is inferred beyond it. Only
// instance members may mention Knecht; Knecht reacts with 👀 immediately and
// posts the follow-up's answer in the thread when it finishes
// (daemon/followups.ts). Every mention gets its OWN run row (kind 'mention')
// as the follow-up's anchor: its work shows up as its own entry in the run
// list with its own timeline, never inside whatever workflow ran last on the
// object. If the object has no session (or its env is gone), the project's
// starter workflow provides one first and the mention run queues behind it;
// without a configured starter workflow Knecht replies with a setup hint
// instead.

// The instance's app slug: the name that must be @-mentioned. Read once from
// the stored GitHub App row (the manifest flow saved it).
let cachedSlug: string | null | undefined
export function appSlug(): string | null {
  if (cachedSlug !== undefined) return cachedSlug
  cachedSlug = db.select({ slug: schema.githubApp.slug }).from(schema.githubApp).where(eq(schema.githubApp.id, 1)).get()?.slug ?? null
  return cachedSlug
}

function mentionsSlug(body: string, slug: string): boolean {
  return new RegExp(`@${slug}\\b`, 'i').test(body)
}

// Handle an issue_comment delivery. Returns a short outcome string for the
// webhook's log line.
export async function handleMention(project: Project, payload: GithubPayload): Promise<string> {
  if (payload.action !== 'created') return 'ignored (not a new comment)'
  const slug = appSlug()
  if (!slug) return 'ignored (no app slug stored)'

  const body = payload.comment?.body ?? ''
  const author = (payload.comment?.user?.login ?? '').toLowerCase()
  if (!body || !author) return 'ignored (empty comment)'
  // Never react to Knecht's own replies (or any bot): the guaranteed reply
  // would otherwise loop.
  if (payload.comment?.user?.type === 'Bot') return 'ignored (bot comment)'
  if (!mentionsSlug(body, slug)) return 'ignored (no mention)'
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

  // Acknowledge immediately: the member sees Knecht picked it up while the
  // env boots. Best-effort; a failed reaction never blocks the work.
  if (typeof payload.comment?.id === 'number') {
    void addCommentReaction(project.owner, project.name, payload.comment.id, 'eyes').catch(() => {})
  }

  const session = resolveSession(project, object, null)

  // A session whose env still exists takes the mention as a plain follow-up.
  // A fresh or expired one needs the starter workflow to (re)provide the
  // checkout and environment first; the follow-up queues behind that run.
  // (A second mention while the starter is still queued must not start a
  // second starter: pending work means the env is already on its way.)
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

  // Always through the dispatcher: it serializes per session, so a mention
  // landing while the session is busy simply waits in order (ADR 0006), and
  // two rapid mentions can never run in parallel.
  const runId = queueMentionRun(project, session, body, author)
  dispatchRuns()
  return `queued mention run ${runId} on session ${session.id}`
}

// The mention's own run row plus the follow-up that drives it. The run is an
// anchor, not runner work: the dispatcher skips kind 'mention' and the
// follow-up executor mirrors its status (daemon/followups.ts).
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

// The one-time setup hint: a mention arrived but no starter workflow can
// provide an environment. Posted as a normal reply so the member is not left
// wondering; best-effort.
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
