import { and, eq, inArray, max } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Followup, Project, Run } from '../db/schema'
import { runFollowupPrompt } from '../workflows/actions/ai'
import type { ActionRuntime } from '../workflows/actions'
import { createContext } from '../workflows/context'
import { getProject, getRun } from '../utils/entities'
import { runCheckoutDir } from '../utils/storage'
import { tryParseJson } from '../utils/json'
import { currentBranch } from './git'
import { appendLog, streamInSandbox } from './runner'
import { copyIntoSandbox, execInSandbox } from './sandbox'
import { ensureEnvUp, rebootEnv, rehydrateEnv } from './envs'

// Execute a follow-up: a prompt sent to a FINISHED run (plan:
// docs/plans/run-follow-ups.md). The run's EXISTING sandbox is reused, never
// recreated: 'up' runs immediately, 'stopped' restarts the same container,
// only 'archived' needs a real restore. The agent continues the run's
// opencode session (--continue), commits/pushes itself with plain git, and
// the epilogue here is the deterministic fallback for changes it left
// uncommitted. Everything is recorded as a run_steps row with
// origin 'followup', so the run timeline shows the whole conversation.

// A follow-up's step-row log keeps at most this much (mirrors the runner's cap).
const STEP_LOG_CAP = 256 * 1024

// Whether a run has a follow-up waiting or executing (the API refuses a second
// one; follow-ups per run are strictly sequential).
export function hasActiveFollowup(runId: number): boolean {
  const row = db
    .select({ id: schema.followups.id })
    .from(schema.followups)
    .where(and(
      eq(schema.followups.runId, runId),
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
    const run = followup && getRun(followup.runId)
    const project = run && getProject(run.projectId)
    if (!followup || !run || !project) {
      if (followup) finishFollowup(followupId, 'failed', 'Run or project no longer exists')
      return
    }

    try {
      await execFollowup(followup, run, project)
      finishFollowup(followupId, 'success')
    }
    catch (e) {
      appendLog(run.id, `\n✗ Follow-up failed: ${(e as Error).message}\n`)
      finishFollowup(followupId, 'failed', (e as Error).message)
    }
  }
  catch (e) {
    finishFollowup(followupId, 'failed', (e as Error).message)
  }
}

async function execFollowup(followup: Followup, run: Run, project: Project): Promise<void> {
  appendLog(run.id, `\n▶ Follow-up${followup.requestedBy ? ` (by ${followup.requestedBy})` : ''}\n`)

  // Revive the run's environment the same way POST /api/runs/:id/reboot does;
  // an 'up' env just gets its idle clock reset.
  if (run.envState === 'archived') await rehydrateEnv(run.id)
  else if (run.envState === 'stopped') await rebootEnv(run.id)
  else await ensureEnvUp(run.id)

  // The follow-up's own timeline row, appended after the pinned workflow steps
  // (and any earlier follow-ups). The runner's resume logic ignores it (origin).
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
    startedAt: new Date(),
  }).returning({ id: schema.runSteps.id }).get()

  let rowLog = ''
  const log = (text: string) => {
    appendLog(run.id, text)
    rowLog = (rowLog + text).slice(-STEP_LOG_CAP)
  }
  const finalizeRow = (patch: { status: 'success' | 'failed', outputs?: Record<string, unknown>, error?: string }) => {
    db.update(schema.runSteps)
      .set({ ...patch, log: rowLog, finishedAt: new Date() })
      .where(eq(schema.runSteps.id, row.id))
      .run()
  }

  const controller = new AbortController()
  const rt: ActionRuntime = {
    runId: run.id,
    project,
    checkoutDir: runCheckoutDir(run.id),
    ctx: createContext(run.id, project, run.inputs ?? {}),
    log,
    signal: controller.signal,
    sandbox: {
      ensureUp: () => ensureEnvUp(run.id),
      stream: (command, opts) => streamInSandbox(run.id, command, log, opts?.env, controller.signal),
      copyIn: (hostPath, sandboxPath) => copyIntoSandbox(run.id, hostPath, sandboxPath),
    },
  }

  try {
    const tail = await runFollowupPrompt(rt, followupMessage(followup))
    const reply = await readAgentReply(run.id, followup.startedAt ?? followup.createdAt) ?? tail
    await syncRunBranch(run.id, rt)
    finalizeRow({ status: 'success', outputs: { text: reply.slice(0, 8 * 1024) } })
    log(`\n✓ Follow-up done\n`)
  }
  catch (e) {
    finalizeRow({ status: 'failed', error: (e as Error).message })
    throw e
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

async function readAgentReply(runId: number, since: Date): Promise<string | null> {
  try {
    // bash -l so opencode is on PATH (same as the ai step). The SQL contains
    // single quotes (JSON paths), so they are shell-escaped for the wrapping
    // single quotes.
    const sql = agentReplySql(since.getTime()).replace(/'/g, '\'\\\'\'')
    const { stdout } = await execInSandbox(runId, ['bash', '-lc', `opencode db --format json '${sql}'`])
    const rows = tryParseJson(String(stdout ?? '').trim())
    const text = Array.isArray(rows) ? (rows[0] as { text?: unknown } | undefined)?.text : undefined
    return typeof text === 'string' && text.trim() ? text : null
  }
  catch {
    return null
  }
}

// The prompt as the agent sees it: a header marking it as a NEW instruction
// (the session may have ended in an output-contract exchange, where the agent
// was told finished work needs no redoing; without the header it reads a
// follow-up as that and does nothing), the user's text, and the publishing
// default: whether to publish is up to the prompt, with one exception, a run
// that already has an open PR stays current so the PR never silently diverges
// from the preview.
function followupMessage(followup: Followup): string {
  const publish = 'Publishing: if this run already has an open pull request, commit your changes (in logical chunks with proper messages) and push when you are done; never open a second PR. Otherwise leave your changes in the working tree for review in the preview, unless the request above asks you to commit, push or open a PR.'
  return `A user sent this follow-up request to the finished run. It is a new instruction, not a schema correction: act on it now. Any earlier output contract does not apply to this message.\n\n${followup.prompt}\n\n${publish}`
}

// Keep runs.branch honest after the agent worked with plain git: the checkout
// is the source of truth, the DB copy only feeds the dashboard's branch chip.
// Best-effort; the checkout may be mid-teardown.
async function syncRunBranch(runId: number, rt: ActionRuntime): Promise<void> {
  try {
    const branch = await currentBranch(rt.checkoutDir)
    // 'HEAD' is a detached checkout, not a real branch name: never record it.
    if (branch !== rt.project.defaultBranch && branch !== 'HEAD') {
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
