import { setTimeout as sleep } from 'node:timers/promises'
import { eq, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project } from '../db/schema'
import type { Step } from '../../shared/utils/workflow'
import { getWorkflow } from '../workflows'
import { actionFor, type ActionRuntime } from '../workflows/actions'
import { createContext, renderStepParams, type RunContext } from '../workflows/context'
import { runSandboxName } from '../utils/storage'
import { getInstallationToken } from '../utils/github-app'
import { prepareRunCheckout } from './git'
import { readDdevHosts, writeDdevConfig } from './ddev'
import { copyIntoSandbox, execInSandbox } from './sandbox'
import { ensureEnvUp } from './envs'

// The in-process serial runner (tech-stack.md §4). Each run gets its OWN
// sandbox (run-isolation.md): an isolated git worktree bind-mounted into a
// per-run Sysbox container, whose inner daemon boots the project's full ddev
// stack — router included — and a freshly-imported DB. Project-facing steps
// (ddev, bash/agent) exec INSIDE the sandbox; git steps run host-side against
// the worktree. The run row tracks both the run status and the environment
// state (envState = the sandbox's state), which the preview proxy and the
// idle-stopper read. SSE is deferred — the UI polls the row.
//
// Execution is engine-generic (workflow-engine-plan.md D3–D5): the step
// sequence is PINNED onto the run row at start; each step gets a run_steps row
// whose result is persisted before the next step runs; the step's error policy
// (retry with exponential backoff, continueOnError) wraps every action the
// same way.

// Cap a step's stored outputs (workflow-engine-plan.md D4): results transit the
// context and the DB — large data belongs in the sandbox filesystem, passed by
// path/reference.
const MAX_OUTPUT_BYTES = 64 * 1024

// Kick off a run. Returns immediately; execution continues in the background.
// Repo credentials are minted on demand from the GitHub App (github-app.ts) —
// installation tokens expire after 1h, so each git network operation fetches a
// fresh one instead of holding a single token across a possibly-long run.
export function startRun(runId: number, project: Project): void {
  void execRun(runId, project).catch((e) => {
    appendLog(runId, `\nRunner crashed: ${(e as Error).message}\n`)
    finish(runId, 'failed')
  })
}

async function execRun(runId: number, project: Project): Promise<void> {
  const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get()
  if (!run) return

  // Pin the definition: from here on the run executes this snapshot, immune to
  // workflow edits (and to the workflow being deleted mid-queue).
  let steps = run.steps
  if (!steps) {
    const workflow = getWorkflow(run.workflow)
    if (!workflow) {
      finish(runId, 'failed')
      return
    }
    steps = workflow.steps
    db.update(schema.runs).set({ steps }).where(eq(schema.runs.id, runId)).run()
  }

  db.update(schema.runs)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(schema.runs.id, runId))
    .run()

  // Log routing: everything lands in runs.log (the UI's live stream); while a
  // step is executing, its slice is ALSO appended to that step's run_steps row.
  let currentStepRow: number | null = null
  const log = (text: string) => {
    appendLog(runId, text)
    if (currentStepRow !== null) {
      db.update(schema.runSteps)
        .set({ log: sql`${schema.runSteps.log} || ${text}` })
        .where(eq(schema.runSteps.id, currentStepRow))
        .run()
    }
  }

  try {
    log(`▶ Preparing isolated checkout\n`)
    const token = await getInstallationToken(project.owner, project.name)
    const dir = await prepareRunCheckout(project, runId, token, log, run.branch ?? project.defaultBranch)

    // Read the repo's own ddev host set and store it (the proxy serves the
    // whole set — readDdevHosts — under per-run preview origins; the UI builds
    // its host switcher from the stored list).
    const hosts = readDdevHosts(dir)
    db.update(schema.runs)
      .set({ previewHosts: hosts.all })
      .where(eq(schema.runs.id, runId))
      .run()

    const injected = writeDdevConfig(dir, project.envVars)
    log(`Sandbox: ${runSandboxName(runId)} (host ${hosts.primary ?? '?'}, +${injected} env var(s))\n`)

    const ctx = createContext(runId, project)
    const rt: ActionRuntime = {
      runId,
      project,
      checkoutDir: dir,
      ctx,
      log,
      sandbox: {
        ensureUp: () => ensureEnvUp(runId),
        stream: command => streamInSandbox(runId, command, log),
        copyIn: (hostPath, sandboxPath) => copyIntoSandbox(runId, hostPath, sandboxPath),
      },
    }
    for (const [index, step] of steps.entries()) {
      const outputs = await execStep(runId, index, step, ctx, rt, rowId => currentStepRow = rowId)
      currentStepRow = null
      if (outputs) {
        // steps.<id> is the collision-free reference; the legacy top-level key
        // keeps pre-id templates ({{ branch.name }}, {{ pr.url }}) rendering.
        if (step.id) ctx.steps[step.id] = outputs
        const legacyKey = actionFor(step.type).legacyKey
        if (legacyKey) ctx[legacyKey] = outputs
      }
    }
    log(`\n✓ Done\n`)
    finish(runId, 'success')
  }
  catch (e) {
    currentStepRow = null
    log(`\n✗ ${(e as Error).message}\n`)
    finish(runId, 'failed')
  }
}

// Execute one step under its error policy. The run_steps row is inserted
// before the action runs and finalized (status/outputs/error) before the next
// step is scheduled; retries update the same row. Returns the step's outputs,
// or undefined when it produced none (or failed with continueOnError).
async function execStep(
  runId: number,
  index: number,
  step: Step,
  ctx: RunContext,
  rt: ActionRuntime,
  onRow: (rowId: number) => void,
): Promise<Record<string, unknown> | undefined> {
  const action = actionFor(step.type)
  const rendered = renderStepParams(step, ctx)
  const row = db.insert(schema.runSteps).values({
    runId,
    stepIndex: index,
    stepId: step.id ?? `i${index}`,
    type: step.type,
    params: stepParams(rendered),
    startedAt: new Date(),
  }).returning({ id: schema.runSteps.id }).get()
  onRow(row.id)

  const maxAttempts = Math.max(1, step.retry?.attempts ?? 1)
  for (let attempt = 1; ; attempt++) {
    try {
      const outputs = capOutputs(await action.run(rendered, rt))
      db.update(schema.runSteps)
        .set({ status: 'success', outputs, attempt, finishedAt: new Date() })
        .where(eq(schema.runSteps.id, row.id))
        .run()
      return outputs
    }
    catch (e) {
      const error = (e as Error).message
      if (attempt < maxAttempts) {
        const delay = (step.retry?.backoffSeconds ?? 0) * 2 ** (attempt - 1)
        rt.log(`\nStep failed (attempt ${attempt}/${maxAttempts}): ${error} — retrying in ${delay}s\n`)
        db.update(schema.runSteps)
          .set({ error, attempt })
          .where(eq(schema.runSteps.id, row.id))
          .run()
        await sleep(delay * 1000)
        continue
      }
      db.update(schema.runSteps)
        .set({ status: 'failed', error, attempt, finishedAt: new Date() })
        .where(eq(schema.runSteps.id, row.id))
        .run()
      if (step.continueOnError) {
        rt.log(`\nStep failed: ${error} — continuing (continue on error)\n`)
        return undefined
      }
      throw e
    }
  }
}

// The step's own params for the run_steps snapshot — meta stripped.
function stepParams(step: Step): Record<string, unknown> {
  const { type: _t, id: _i, label: _l, description: _d, continueOnError: _c, retry: _r, ...params } = step
  return params
}

function capOutputs(outputs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!outputs) return undefined
  const size = Buffer.byteLength(JSON.stringify(outputs))
  if (size > MAX_OUTPUT_BYTES) {
    throw new Error(`Step outputs too large (${size} bytes > ${MAX_OUTPUT_BYTES}) — keep large data in the sandbox filesystem and pass a path instead`)
  }
  return outputs
}

// Run a command in the sandbox, streaming its stdout/stderr into the run log
// (routed through the run's logger, so it also lands in the current step's
// row). Resolves with the exit code (never rejects on a non-zero exit — the
// caller decides).
function streamInSandbox(runId: number, command: string[], log: (text: string) => void): Promise<number> {
  const sub = execInSandbox(runId, command, { reject: false, buffer: false })
  sub.stdout?.on('data', (d: Buffer) => log(d.toString()))
  sub.stderr?.on('data', (d: Buffer) => log(d.toString()))
  return sub.then(r => r.exitCode ?? 1)
}

function appendLog(runId: number, text: string): void {
  db.update(schema.runs)
    .set({ log: sql`${schema.runs.log} || ${text}` })
    .where(eq(schema.runs.id, runId))
    .run()
}

function finish(runId: number, status: 'success' | 'failed'): void {
  db.update(schema.runs)
    .set({ status, finishedAt: new Date() })
    .where(eq(schema.runs.id, runId))
    .run()
}
