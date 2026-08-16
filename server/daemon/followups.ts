import { and, eq, inArray, max } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Followup, Project, Run, Session } from '../db/schema'
import { runFollowupPrompt } from '../workflows/actions/ai'
import type { ActionRuntime } from '../workflows/actions'
import { createContext } from '../workflows/context'
import { getProject, getRun, getSessionRow } from '../utils/entities'
import { createIssueComment } from '../utils/github-app'
import { sessionCheckoutDir } from '../utils/storage'
import { tryParseJson } from '../utils/json'
import { agentRepliedSince, withSessionLinks } from '../utils/sessions'
import { currentBranch } from './git'
import { appendLog, runLogBytes, streamInSandbox } from './runner'
import { copyIntoSandbox, execInSandbox } from './sandbox'
import { ensureEnvUp, rebootEnv, rehydrateEnv } from './envs'

// Execute a follow-up: a free-form prompt continuing a session's
// conversation. The session's EXISTING sandbox is reused, never recreated:
// 'up' runs immediately, 'stopped' restarts the same containers, only
// 'archived' needs a real restore (which also brings the conversation back,
// daemon/envs.ts). The agent continues the session's opencode conversation
// (--continue), commits/pushes itself with plain git. Everything is recorded
// as a run_steps row with origin 'followup' on the follow-up's anchor run,
// so the run timeline shows the whole conversation.

// The abort controllers of follow-ups THIS process is executing, keyed by
// session (one active follow-up per session), so a cancel (POST
// /api/runs/:id/followups/cancel) can stop the executor mid-flight: the
// streamed sandbox command is killed through the signal.
const controllers = new Map<number, AbortController>()

// Abort the follow-up this process is executing for a session. Returns false
// when none is in-flight here (still queued, or a stale 'running' row after a
// crash); the caller has already flipped the row, so nothing else is needed.
export function cancelFollowup(sessionId: number): boolean {
  const controller = controllers.get(sessionId)
  if (!controller) return false
  controller.abort()
  return true
}

// Whether a session has a follow-up waiting or executing (the API refuses a
// second one; follow-ups per session are strictly sequential).
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

// Start a follow-up if it is still queued. Claim-first, so the fast lane
// (POST on an 'up' env) and the dispatcher can both call this without ever
// double-running one. The returned promise never rejects (the dispatcher and
// the fast lane both fire-and-forget it).
export async function startFollowup(followupId: number): Promise<void> {
  try {
    const claimed = db.update(schema.followups)
      .set({ status: 'running', startedAt: new Date() })
      .where(and(eq(schema.followups.id, followupId), eq(schema.followups.status, 'queued')))
      .run()
    if (!claimed.changes) return

    const followup = db.select().from(schema.followups).where(eq(schema.followups.id, followupId)).get()
    const session = followup && getSessionRow(followup.sessionId)
    const run = followup && getRun(followup.runId)
    const project = session && getProject(session.projectId)
    if (!followup || !session || !run || !project) {
      if (followup) finishFollowup(followupId, 'failed', 'Session or project no longer exists')
      return
    }

    const controller = new AbortController()
    controllers.set(session.id, controller)
    try {
      const reply = await execFollowup(followup, session, run, project, controller)
      finishFollowup(followupId, 'success')
      await postMentionReply(followup, session, project, reply)
    }
    catch (e) {
      const cancelled = controller.signal.aborted
      appendLog(run.id, cancelled ? `\n✗ Follow-up cancelled\n` : `\n✗ Follow-up failed: ${(e as Error).message}\n`)
      finishFollowup(followupId, 'failed', cancelled ? 'Cancelled' : (e as Error).message)
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
  // Offset BEFORE the banner: the banner and the env-revive output below
  // belong to this follow-up's log segment on the dashboard.
  const logStart = runLogBytes(run.id)
  appendLog(run.id, `\n▶ Follow-up${followup.requestedBy ? ` (by ${followup.requestedBy})` : ''}\n`)

  // Revive the session's environment the same way POST /api/runs/:id/reboot
  // does; an 'up' env just gets its idle clock reset.
  if (session.envState === 'archived') await rehydrateEnv(session.id)
  else if (session.envState === 'stopped') await rebootEnv(session.id)
  else await ensureEnvUp(session.id)

  // The follow-up's own timeline row, appended after the anchor run's pinned
  // workflow steps (and any earlier follow-ups). The runner's resume logic
  // ignores it (origin).
  const nextIndex = db
    .select({ value: max(schema.runSteps.stepIndex) })
    .from(schema.runSteps)
    .where(eq(schema.runSteps.runId, run.id))
    .get()
  const row = db.insert(schema.runSteps).values({
    runId: run.id,
    stepIndex: (nextIndex?.value ?? -1) + 1,
    stepId: `followup-${followup.id}`,
    type: 'ai',
    origin: 'followup',
    params: { prompt: followup.prompt },
    logStart,
    startedAt: new Date(),
  }).returning({ id: schema.runSteps.id }).get()

  const log = (text: string) => appendLog(run.id, text)
  const finalizeRow = (patch: { status: 'success' | 'failed', outputs?: Record<string, unknown>, error?: string }) => {
    db.update(schema.runSteps)
      .set({ ...patch, finishedAt: new Date() })
      .where(eq(schema.runSteps.id, row.id))
      .run()
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
      ensureUp: () => ensureEnvUp(session.id),
      stream: (command, opts) => streamInSandbox(session.id, command, log, opts?.env, controller.signal),
      copyIn: (hostPath, sandboxPath) => copyIntoSandbox(session.id, hostPath, sandboxPath),
    },
  }

  try {
    const tail = await runFollowupPrompt(rt, followupMessage(followup))
    const reply = await readAgentReply(session.id, followup.startedAt ?? followup.createdAt) ?? tail
    await syncSessionBranch(session.id, run.id, rt)
    finalizeRow({ status: 'success', outputs: { text: reply.slice(0, 8 * 1024) } })
    log(`\n✓ Follow-up done\n`)
    return reply
  }
  catch (e) {
    finalizeRow({ status: 'failed', error: controller.signal.aborted ? 'Cancelled' : (e as Error).message })
    throw e
  }
}

// The guaranteed thread reply (ADR 0007): a mention always gets an answer on
// its object. When the agent already posted on the thread itself during this
// follow-up (knecht-reply), the guarantee is met and auto-posting the final
// assistant message (or a late failure notice) would just duplicate what the
// thread already heard. Best-effort: the follow-up already succeeded/failed
// either way.
async function postMentionReply(followup: Followup, session: Session, project: Project, text: string): Promise<void> {
  if (followup.origin !== 'mention' || !session.objectNumber) return
  if (agentRepliedSince(session.id, followup.startedAt ?? followup.createdAt)) return
  try {
    await createIssueComment(project.owner, project.name, session.objectNumber, withSessionLinks(text, session.id))
  }
  catch (e) {
    appendLog(followup.runId, `\nCould not post the reply on the thread: ${(e as Error).message}\n`)
  }
}

// The agent's clean final reply, for the dashboard's follow-up chat: the
// streamed tail (kept in the run log) is ANSI codes and tool output, but
// opencode's session db in the sandbox has the real message parts. Pulls the
// newest assistant text written since this follow-up started; null (the
// caller falls back to the tail) when there is none or the query fails.
function agentReplySql(sinceMs: number): string {
  return 'SELECT json_extract(p.data, \'$.text\') AS text'
    + ' FROM part p JOIN message m ON p.message_id = m.id'
    + ' WHERE json_extract(m.data, \'$.role\') = \'assistant\''
    + ' AND json_extract(p.data, \'$.type\') = \'text\''
    + ` AND m.time_created > ${sinceMs}`
    + ' ORDER BY p.time_created DESC LIMIT 1'
}

// Exported for the mention path (Phase 2): the guaranteed thread reply reads
// the same clean answer the dashboard shows.
export async function readAgentReply(sessionId: number, since: Date): Promise<string | null> {
  try {
    // bash -l so opencode is on PATH (same as the ai step). The SQL contains
    // single quotes (JSON paths), so they are shell-escaped for the wrapping
    // single quotes.
    const sql = agentReplySql(since.getTime()).replace(/'/g, '\'\\\'\'')
    const { stdout } = await execInSandbox(sessionId, ['bash', '-lc', `opencode db --format json '${sql}'`])
    const rows = tryParseJson(String(stdout ?? '').trim())
    const text = Array.isArray(rows) ? (rows[0] as { text?: unknown } | undefined)?.text : undefined
    return typeof text === 'string' && text.trim() ? text : null
  }
  catch {
    return null
  }
}

// The prompt as the agent sees it: a header marking it as a NEW instruction
// (the conversation may have ended in an output-contract exchange, where the
// agent was told finished work needs no redoing; without the header it reads
// a follow-up as that and does nothing), the user's text, and the publishing
// default: whether to publish is up to the prompt, with one exception, a
// session that already has an open PR stays current so the PR never silently
// diverges from the preview.
function followupMessage(followup: Followup): string {
  const publish = 'Publishing: if this session already has an open pull request, commit your changes (in logical chunks with proper messages) and push when you are done; never open a second PR. Otherwise leave your changes in the working tree for review in the preview, unless the request above asks you to commit, push or open a PR.'
  return `A user sent this follow-up request. It is a new instruction, not a schema correction: act on it now. Any earlier output contract does not apply to this message.\n\n${followup.prompt}\n\n${publish}`
}

// Keep the session's branch honest after the agent worked with plain git: the
// checkout is the source of truth, the DB copy only feeds the dashboard's
// branch chip. Best-effort; the checkout may be mid-teardown.
async function syncSessionBranch(sessionId: number, runId: number, rt: ActionRuntime): Promise<void> {
  try {
    const branch = await currentBranch(rt.checkoutDir)
    // 'HEAD' is a detached checkout, not a real branch name: never record it.
    if (branch !== rt.project.defaultBranch && branch !== 'HEAD') {
      db.update(schema.sessions).set({ branch }).where(eq(schema.sessions.id, sessionId)).run()
      db.update(schema.runs).set({ branch }).where(eq(schema.runs.id, runId)).run()
    }
  }
  catch {
    // No checkout, no sync.
  }
}

function finishFollowup(id: number, status: 'success' | 'failed', error?: string): void {
  db.update(schema.followups)
    .set({ status, error: error ?? null, finishedAt: new Date() })
    .where(eq(schema.followups.id, id))
    .run()
}
