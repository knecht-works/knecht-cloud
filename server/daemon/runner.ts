import { setTimeout as sleep } from 'node:timers/promises'
import { eq, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project } from '../db/schema'
import { COMPOSITE_CHILD_KEYS, isComposite, STEP_META_KEYS, type CompositeStep, type Step } from '../../shared/utils/workflow'
import { getWorkflow } from '../workflows'
import { actionFor, type ActionError, type ActionRuntime } from '../workflows/actions'
import { createContext, evalConditions, renderStepParams, resolveLoopItems, type RunContext } from '../workflows/context'
import { runSandboxName } from '../utils/storage'
import { getInstallationToken } from '../utils/github-app'
import { prepareRunCheckout } from './git'
import { readDdevHosts, writeDdevConfig } from './ddev'
import { copyIntoSandbox, execInSandbox } from './sandbox'
import { ensureEnvUp } from './envs'

// The in-process serial runner (tech-stack.md §4). Each run gets its OWN
// sandbox (run-isolation.md): an isolated git worktree bind-mounted into a
// per-run Sysbox container, whose inner daemon boots the project's full ddev
// stack (router included) and a freshly-imported DB. Project-facing steps
// (ddev, bash/agent) exec INSIDE the sandbox; git steps run host-side against
// the worktree. The run row tracks both the run status and the environment
// state (envState = the sandbox's state), which the preview proxy and the
// idle-stopper read. SSE is deferred: the UI polls the row.
//
// Execution is engine-generic (workflow-engine-plan.md D3–D5): the step
// sequence is PINNED onto the run row at start; each step gets a run_steps row
// whose result is persisted before the next step runs; the step's error policy
// (retry with exponential backoff, continueOnError) wraps every action the
// same way.

// Cap a step's stored outputs (workflow-engine-plan.md D4): results transit the
// context and the DB: large data belongs in the sandbox filesystem, passed by
// path/reference.
const MAX_OUTPUT_BYTES = 64 * 1024

// Execute a run. Called only by the dispatcher (server/plugins/dispatcher.ts),
// which awaits the returned promise to track the concurrency slot; the promise
// never rejects. Repo credentials are minted on demand from the GitHub App
// (github-app.ts): installation tokens expire after 1h, so each git network
// operation fetches a fresh one instead of holding a single token across a
// possibly-long run.
export function startRun(runId: number, project: Project): Promise<void> {
  return execRun(runId, project).catch((e) => {
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
  // step is executing, its slice is ALSO buffered for that step's run_steps
  // row and written once when the row is finalized: per-chunk SQL appends on
  // this hot path would rewrite the growing blob for every stdout event.
  // Nested steps (if/loop) re-point `current` to their own row and restore the
  // parent's when done.
  const rowLog: RowLog = { current: null, buffers: new Map() }
  const log = (text: string) => {
    appendLog(runId, text)
    if (rowLog.current !== null) {
      const buffered = (rowLog.buffers.get(rowLog.current) ?? '') + text
      rowLog.buffers.set(rowLog.current, buffered.length > STEP_LOG_CAP ? buffered.slice(-STEP_LOG_CAP) : buffered)
    }
  }

  try {
    log(`▶ Preparing isolated checkout\n`)
    const token = await getInstallationToken(project.owner, project.name)
    const dir = await prepareRunCheckout(project, runId, token, log, run.branch ?? project.defaultBranch)

    // Read the repo's own ddev host set and store it (the proxy serves the
    // whole set (readDdevHosts) under per-run preview origins; the UI builds
    // its host switcher from the stored list).
    const hosts = readDdevHosts(dir)
    db.update(schema.runs)
      .set({ previewHosts: hosts.all })
      .where(eq(schema.runs.id, runId))
      .run()

    const injected = writeDdevConfig(dir, project.envVars)
    log(`Sandbox: ${runSandboxName(runId)} (host ${hosts.primary ?? '?'}, +${injected} env var(s))\n`)

    const ctx = createContext(runId, project, run.inputs ?? {})
    const rt: ActionRuntime = {
      runId,
      project,
      checkoutDir: dir,
      ctx,
      log,
      sandbox: {
        ensureUp: () => ensureEnvUp(runId),
        stream: (command, opts) => streamInSandbox(runId, command, log, opts?.env),
        copyIn: (hostPath, sandboxPath) => copyIntoSandbox(runId, hostPath, sandboxPath),
      },
    }
    await execSteps(runId, steps, ctx, rt, rowLog)
    log(`\n✓ Done\n`)
    finish(runId, 'success')
  }
  catch (e) {
    rowLog.current = null
    log(`\n✗ ${(e as Error).message}\n`)
    finish(runId, 'failed')
  }
}

// Where step-scoped log slices go (see execRun): `current` is pushed/restored
// like a stack around nested execution; `buffers` holds each open row's slice
// until the row is finalized.
interface RowLog {
  current: number | null
  buffers: Map<number, string>
}

// A step row keeps at most this much of its log slice (the run log has the
// full stream).
const STEP_LOG_CAP = 256 * 1024

// Position of a nested step list: which composite step owns it and, inside a
// loop, which iteration; `collect` gathers the iteration's outputs.
interface StepScope {
  parentStepId?: string
  iteration?: number
  collect?: Record<string, unknown>
}

// Execute a step list in order, merging each step's outputs into the context.
// Recurses through composite steps (if/loop) via execStep → runComposite.
async function execSteps(
  runId: number,
  steps: Step[],
  ctx: RunContext,
  rt: ActionRuntime,
  rowLog: RowLog,
  scope: StepScope = {},
): Promise<void> {
  for (const [index, step] of steps.entries()) {
    const outputs = await execStep(runId, index, step, ctx, rt, rowLog, scope)
    if (outputs && step.id) {
      // steps.<id> is the collision-free reference; the legacy top-level key
      // keeps pre-id templates ({{ branch.name }}, {{ pr.url }}) rendering.
      ctx.steps[step.id] = outputs
      if (scope.collect) scope.collect[step.id] = outputs
      const legacyKey = isComposite(step) ? undefined : actionFor(step.type).legacyKey
      if (legacyKey) ctx[legacyKey] = outputs
    }
  }
}

// Run a composite step's body. The composite's own run_steps row is already
// open (execStep); each sub-step gets its own row tagged with
// parentStepId/iteration so the timeline renders the tree.
async function runComposite(
  runId: number,
  step: CompositeStep,
  ctx: RunContext,
  rt: ActionRuntime,
  rowLog: RowLog,
  scope: StepScope,
): Promise<Record<string, unknown>> {
  if (step.type === 'if') {
    const matched = evalConditions(step.conditions, ctx)
    rt.log(`\n▶ if: conditions ${matched ? 'matched → then' : 'not matched → else'}\n`)
    const branch = matched ? step.then : step.else
    // An if is transparent to an enclosing loop: its sub-steps keep the
    // iteration tag and contribute to the iteration's collected outputs.
    await execSteps(runId, branch, ctx, rt, rowLog, { parentStepId: step.id, iteration: scope.iteration, collect: scope.collect })
    return { matched }
  }

  const items = resolveLoopItems(step.items, ctx)
  rt.log(`\n▶ loop: ${items.length} iteration(s)\n`)
  const results: Record<string, unknown>[] = []
  // Innermost loop wins for {{ loop.item }}/{{ loop.index }}; restore the
  // outer loop's values when done (nested loops).
  const prevLoop = ctx.loop
  try {
    for (const [index, item] of items.entries()) {
      ctx.loop = { item, index }
      const collect: Record<string, unknown> = {}
      await execSteps(runId, step.steps, ctx, rt, rowLog, { parentStepId: step.id, iteration: index, collect })
      results.push(collect)
    }
  }
  finally {
    ctx.loop = prevLoop
  }
  return { results, count: items.length }
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
  rowLog: RowLog,
  scope: StepScope,
): Promise<Record<string, unknown> | undefined> {
  // Composites render nothing up front: conditions/loop items are evaluated
  // against the LIVE context as the body executes.
  const action = isComposite(step) ? null : actionFor(step.type)
  const rendered = action ? renderStepParams(step, ctx, action.rawParams) : step
  const row = db.insert(schema.runSteps).values({
    runId,
    stepIndex: index,
    stepId: step.id ?? `i${index}`,
    type: step.type,
    params: stepParams(rendered),
    parentStepId: scope.parentStepId,
    iteration: scope.iteration,
    startedAt: new Date(),
  }).returning({ id: schema.runSteps.id }).get()
  const prevRow = rowLog.current
  rowLog.current = row.id
  rowLog.buffers.set(row.id, '')

  const finalize = (patch: StepRowPatch) => {
    const log = rowLog.buffers.get(row.id) ?? ''
    rowLog.buffers.delete(row.id)
    updateStepRow(row.id, { ...patch, log, finishedAt: new Date() })
  }

  try {
    const maxAttempts = Math.max(1, step.retry?.attempts ?? 1)
    for (let attempt = 1; ; attempt++) {
      try {
        const outputs = capOutputs(action
          ? await action.run(rendered, rt)
          : await runComposite(runId, step as CompositeStep, ctx, rt, rowLog, scope))
        finalize({ status: 'success', outputs, attempt })
        return outputs
      }
      catch (e) {
        const error = (e as Error).message
        if (attempt < maxAttempts) {
          const delay = (step.retry?.backoffSeconds ?? 0) * 2 ** (attempt - 1)
          rt.log(`\nStep failed (attempt ${attempt}/${maxAttempts}): ${error}. Retrying in ${delay}s\n`)
          updateStepRow(row.id, { error, attempt })
          await sleep(delay * 1000)
          continue
        }
        // An ActionError carries the failure's outputs (bash exit code + output
        // tail, an HTTP error response), recorded, and still referencable by
        // later steps when the run continues.
        const failOutputs = capOutputs((e as ActionError).outputs)
        finalize({ status: 'failed', error, attempt, outputs: failOutputs })
        if (step.continueOnError) {
          rt.log(`\nStep failed: ${error}. Continuing (continue on error)\n`)
          return failOutputs
        }
        throw e
      }
    }
  }
  finally {
    rowLog.current = prevRow
  }
}

type StepRowPatch = Partial<typeof schema.runSteps.$inferInsert>

function updateStepRow(rowId: number, patch: StepRowPatch): void {
  db.update(schema.runSteps).set(patch).where(eq(schema.runSteps.id, rowId)).run()
}

// The step's own params for the run_steps snapshot: meta stripped, and
// composite sub-step definitions dropped (they live in the pinned run
// snapshot; duplicating whole subtrees into every row helps nobody).
function stepParams(step: Step): Record<string, unknown> {
  const skip = new Set<string>(STEP_META_KEYS)
  if (isComposite(step)) for (const key of COMPOSITE_CHILD_KEYS[step.type]) skip.add(key)
  return Object.fromEntries(Object.entries(step).filter(([key]) => !skip.has(key)))
}

function capOutputs(outputs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!outputs) return undefined
  const size = Buffer.byteLength(JSON.stringify(outputs))
  if (size > MAX_OUTPUT_BYTES) {
    throw new Error(`Step outputs too large (${size} bytes > ${MAX_OUTPUT_BYTES}): keep large data in the sandbox filesystem and pass a path instead`)
  }
  return outputs
}

// How much command output the runner keeps in memory for the action to
// inspect (bash `stdout` output, the js step's result marker). The run log
// gets the full stream regardless.
const STREAM_TAIL_CHARS = 128 * 1024

// Run a command in the sandbox, streaming its stdout/stderr into the run log
// (routed through the run's logger, so it also lands in the current step's
// row) while capturing a tail for the caller. Resolves with the exit code:
// never rejects on a non-zero exit, the caller decides.
function streamInSandbox(runId: number, command: string[], log: (text: string) => void, env?: Record<string, string>): Promise<{ code: number, tail: string }> {
  const sub = execInSandbox(runId, command, { reject: false, buffer: false }, env)
  // Chunk list instead of string concat: re-slicing a full 128 KB string per
  // stdout event would make chatty commands quadratic.
  const chunks: string[] = []
  let size = 0
  const capture = (d: Buffer) => {
    const text = d.toString()
    log(text)
    chunks.push(text)
    size += text.length
    while (size > STREAM_TAIL_CHARS && chunks.length > 1) {
      size -= chunks.shift()!.length
    }
  }
  sub.stdout?.on('data', capture)
  sub.stderr?.on('data', capture)
  return sub.then(r => ({ code: r.exitCode ?? 1, tail: chunks.join('').slice(-STREAM_TAIL_CHARS) }))
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
