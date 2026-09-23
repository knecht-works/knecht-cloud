import { setTimeout as sleep } from 'node:timers/promises'
import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project, Session } from '../db/schema'
import { COMPOSITE_CHILD_KEYS, defaultStepTimeout, isComposite, isCompositeType, STEP_META_KEYS, type CompositeStep, type Step } from '../../shared/utils/workflow'
import { getWorkflow } from '../workflows'
import { actionFor, type ActionError, type ActionRuntime, type RegisteredAction } from '../workflows/actions'
import { createContext, evalConditions, renderStepParams, resolveLoopItems, type RunContext } from '../workflows/context'
import { formatEnvSummary } from '../../shared/utils/env-spec'
import { runWorkspacePath } from '../../shared/utils/routes'
import { sessionSandboxName } from '../utils/storage'
import { getInstallationToken } from '../utils/github-app'
import { getRun, getWorkflowRow } from '../utils/entities'
import { dashboardOrigin } from '../utils/origin'
import { agentRepliedSince, describeObject, sessionObject } from '../utils/sessions'
import { getIntegration } from '../integrations'
import { handBackObject, takeObject } from '../integrations/assignee'
import { prepareSessionCheckout } from './git'
import { configureSessionEnv } from './ddev'
import { copyIntoSandbox, spawnInSandbox, startEnvStack, streamInSandbox, WEB_PROJECT_DIR } from './sandbox'
import { ensureEnvUp } from './envs'

const MAX_OUTPUT_BYTES = 64 * 1024

const controllers = new Map<number, AbortController>()

export function cancelRun(runId: number): boolean {
  const controller = controllers.get(runId)
  if (!controller) return false
  controller.abort()
  return true
}

export function resumePoint(runId: number): { fromIndex: number, tailRowId: number | null } {
  // Follow-up rows appended after the run finished must not shift the resume point.
  const top = db
    .select({ id: schema.runSteps.id, stepIndex: schema.runSteps.stepIndex, status: schema.runSteps.status })
    .from(schema.runSteps)
    .where(and(
      eq(schema.runSteps.runId, runId),
      isNull(schema.runSteps.parentStepId),
      eq(schema.runSteps.origin, 'workflow'),
    ))
    .orderBy(asc(schema.runSteps.id))
    .all()
  const last = top.at(-1)
  if (!last) return { fromIndex: 0, tailRowId: null }
  if (last.status === 'success') return { fromIndex: last.stepIndex + 1, tailRowId: null }
  return { fromIndex: last.stepIndex, tailRowId: last.id }
}

export function startRun(runId: number, project: Project): Promise<void> {
  return execRun(runId, project).catch((e) => {
    appendLog(runId, `\nRunner crashed: ${(e as Error).message}\n`)
    finish(runId, 'failed')
  })
}

async function execRun(runId: number, project: Project): Promise<void> {
  const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get()
  if (!run) return
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, run.sessionId)).get()
  if (!session) {
    appendLog(runId, `\nSession ${run.sessionId} no longer exists\n`)
    finish(runId, 'failed')
    return
  }

  // Pinned so the run is immune to workflow edits mid-queue.
  let steps = run.steps
  if (!steps) {
    const workflow = run.workflowId ? getWorkflow(run.workflowId) : undefined
    if (!workflow) {
      finish(runId, 'failed')
      return
    }
    steps = workflow.steps
    db.update(schema.runs).set({ steps }).where(eq(schema.runs.id, runId)).run()
  }

  // A cancel can land while the run sits queued; the claim must lose that race.
  const claimed = db.update(schema.runs)
    .set({ status: 'running', startedAt: new Date(), finishedAt: null })
    .where(and(eq(schema.runs.id, runId), eq(schema.runs.status, 'queued')))
    .run()
  if (!claimed.changes) return

  const controller = new AbortController()
  controllers.set(runId, controller)

  const log = (text: string) => appendLog(runId, text)
  await takeObject(session, runId, project, log)

  try {
    const resume = resumePoint(runId)
    if (resume.tailRowId !== null) {
      db.delete(schema.runSteps)
        .where(and(
          eq(schema.runSteps.runId, runId),
          gte(schema.runSteps.id, resume.tailRowId),
          eq(schema.runSteps.origin, 'workflow'),
        ))
        .run()
    }
    if (resume.fromIndex > 0 || resume.tailRowId !== null) {
      log(`\n↻ Retrying from step ${resume.fromIndex + 1}\n`)
    }

    const sessionId = session.id
    log(`▶ Preparing isolated checkout\n`)
    const token = await getInstallationToken(project.owner, project.name)
    const dir = await prepareSessionCheckout(project, sessionId, token, log, session.branch ?? run.branch ?? project.defaultBranch)

    // urlMode is pinned on the first run: the proxy must match the env baked into
    // the environment even if the project setting changes later.
    const urlMode = session.urlMode ?? project.urlMode
    const { env, warnings, injected, devServerPort, changed } = await configureSessionEnv(dir, project, sessionId, urlMode)
    db.update(schema.sessions)
      .set({
        previewHosts: env.hosts.value,
        urlMode,
        previewPort: devServerPort,
        branch: session.branch ?? run.branch ?? project.defaultBranch,
      })
      .where(eq(schema.sessions.id, sessionId))
      .run()
    log(`Environment: ${sessionSandboxName(sessionId)} (${formatEnvSummary(env)}, +${injected} env var(s))\n`)
    for (const warning of warnings) log(`Warning: ${warning}\n`)
    if (changed && session.envState === 'up') {
      log(`Environment definition changed: applying it\n`)
      await startEnvStack(sessionId)
    }

    const ctx = createContext(runId, project, run.inputs ?? {})
    replayOutputs(runId, ctx)
    const rt: ActionRuntime = {
      runId,
      sessionId,
      project,
      checkoutDir: dir,
      ctx,
      log,
      signal: controller.signal,
      sandbox: {
        projectDir: WEB_PROJECT_DIR,
        ensureUp: () => ensureEnvUp(sessionId),
        stream: (command, opts) => streamInSandbox(sessionId, command, log, opts?.env, controller.signal),
        spawn: (command, opts) => spawnInSandbox(sessionId, command, opts?.env),
        copyIn: (hostPath, sandboxPath) => copyIntoSandbox(sessionId, hostPath, sandboxPath),
      },
    }
    await execSteps(runId, steps, ctx, rt, {}, resume.fromIndex)
    log(`\n✓ Done\n`)
    finish(runId, 'success')
    closeObjectlessSession(session.id)
    await notifyRunFinished(runId, project, session, 'success', log)
    await handBackObject(session, runId, project, log)
  }
  catch (e) {
    const cancelled = controller.signal.aborted
    log(cancelled ? `\n✗ Cancelled\n` : `\n✗ ${(e as Error).message}\n`)
    finish(runId, cancelled ? 'cancelled' : 'failed')
    closeObjectlessSession(session.id)
    if (!cancelled) await notifyRunFinished(runId, project, session, 'failed', log)
    await handBackObject(session, runId, project, log)
  }
  finally {
    controllers.delete(runId)
  }
}

// Closed is a display state, not a gate: dashboard follow-ups still land on it.
function closeObjectlessSession(sessionId: number): void {
  db.update(schema.sessions)
    .set({ status: 'closed', closedAt: new Date() })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.objectKind)))
    .run()
}

function replayOutputs(runId: number, ctx: RunContext): void {
  const rows = db
    .select({ stepId: schema.runSteps.stepId, type: schema.runSteps.type, outputs: schema.runSteps.outputs })
    .from(schema.runSteps)
    .where(and(eq(schema.runSteps.runId, runId), eq(schema.runSteps.origin, 'workflow')))
    .orderBy(asc(schema.runSteps.id))
    .all()
  for (const row of rows) {
    if (!row.outputs) continue
    ctx.steps[row.stepId] = row.outputs
    const type = row.type as Step['type']
    const legacyKey = isCompositeType(type) ? undefined : actionFor(type).legacyKey
    if (legacyKey) ctx[legacyKey] = row.outputs
  }
}

interface StepScope {
  parentStepId?: string
  iteration?: number
  collect?: Record<string, unknown>
}

async function execSteps(
  runId: number,
  steps: Step[],
  ctx: RunContext,
  rt: ActionRuntime,
  scope: StepScope = {},
  startIndex = 0,
): Promise<void> {
  for (const [index, step] of steps.entries()) {
    if (index < startIndex) continue
    rt.signal.throwIfAborted()
    const outputs = await execStep(runId, index, step, ctx, rt, scope)
    if (outputs && step.id) {
      // Pre-id templates ({{ pr.url }}) still read the top-level key.
      ctx.steps[step.id] = outputs
      if (scope.collect) scope.collect[step.id] = outputs
      const legacyKey = isComposite(step) ? undefined : actionFor(step.type).legacyKey
      if (legacyKey) ctx[legacyKey] = outputs
    }
  }
}

async function runComposite(
  runId: number,
  step: CompositeStep,
  ctx: RunContext,
  rt: ActionRuntime,
  scope: StepScope,
): Promise<Record<string, unknown>> {
  if (step.type === 'if') {
    const matched = evalConditions(step.conditions, ctx)
    rt.log(`\n▶ if: conditions ${matched ? 'matched → then' : 'not matched → else'}\n`)
    const branch = matched ? step.then : step.else
    await execSteps(runId, branch, ctx, rt, { parentStepId: step.id, iteration: scope.iteration, collect: scope.collect })
    return { matched }
  }

  const items = resolveLoopItems(step.items, ctx)
  rt.log(`\n▶ loop: ${items.length} iteration(s)\n`)
  const results: Record<string, unknown>[] = []
  const prevLoop = ctx.loop
  try {
    for (const [index, item] of items.entries()) {
      ctx.loop = { item, index }
      const collect: Record<string, unknown> = {}
      await execSteps(runId, step.steps, ctx, rt, { parentStepId: step.id, iteration: index, collect })
      results.push(collect)
    }
  }
  finally {
    ctx.loop = prevLoop
  }
  return { results, count: items.length }
}

async function execStep(
  runId: number,
  index: number,
  step: Step,
  ctx: RunContext,
  rt: ActionRuntime,
  scope: StepScope,
): Promise<Record<string, unknown> | undefined> {
  // Not rendered up front: a composite's conditions and items must see the live context.
  const action = isComposite(step) ? null : actionFor(step.type)
  const rendered = action ? renderStepParams(step, ctx, action.rawParams) : step
  // Read the offset before inserting: the action's banner must be the first bytes at it.
  const logStart = runLogBytes(runId)
  const row = db.insert(schema.runSteps).values({
    runId,
    stepIndex: index,
    stepId: step.id ?? `i${index}`,
    type: step.type,
    params: stepParams(rendered),
    parentStepId: scope.parentStepId,
    iteration: scope.iteration,
    logStart,
    startedAt: new Date(),
  }).returning({ id: schema.runSteps.id }).get()

  const finalize = (patch: StepRowPatch) =>
    updateStepRow(row.id, { ...patch, finishedAt: new Date() })

  const maxAttempts = Math.max(1, step.retry?.attempts ?? 1)
  for (let attempt = 1; ; attempt++) {
    try {
      const outputs = capOutputs(action
        ? await runActionTimed(action, rendered, rt, step.timeoutSeconds ?? defaultStepTimeout(step.type))
        : await runComposite(runId, step as CompositeStep, ctx, rt, scope))
      finalize({ status: 'success', outputs, attempt })
      return outputs
    }
    catch (e) {
      const error = (e as Error).message
      if (rt.signal.aborted) {
        finalize({ status: 'cancelled', attempt, error: null })
        throw e
      }
      if (attempt < maxAttempts) {
        const delay = (step.retry?.backoffSeconds ?? 0) * 2 ** (attempt - 1)
        rt.log(`\nStep failed (attempt ${attempt}/${maxAttempts}): ${error}. Retrying in ${delay}s\n`)
        updateStepRow(row.id, { error, attempt })
        await sleep(delay * 1000)
        continue
      }
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

// The race fails the attempt even when an action ignores its signal.
// A timeout is an ordinary failure; only rt.signal marks a cancel.
function runActionTimed(
  action: RegisteredAction,
  step: Step,
  rt: ActionRuntime,
  timeoutSeconds: number,
): Promise<Record<string, unknown> | undefined> {
  const timeout = AbortSignal.timeout(timeoutSeconds * 1000)
  const signal = AbortSignal.any([rt.signal, timeout])
  const timedRt: ActionRuntime = {
    ...rt,
    signal,
    sandbox: {
      ...rt.sandbox,
      stream: (command, opts) => streamInSandbox(rt.sessionId, command, rt.log, opts?.env, signal),
    },
  }
  return new Promise((resolve, reject) => {
    const onTimeout = () => reject(new Error(`Step timed out after ${timeoutSeconds}s`))
    timeout.addEventListener('abort', onTimeout, { once: true })
    action.run(step, timedRt)
      .then(resolve, reject)
      .finally(() => timeout.removeEventListener('abort', onTimeout))
  })
}

type StepRowPatch = Partial<typeof schema.runSteps.$inferInsert>

function updateStepRow(rowId: number, patch: StepRowPatch): void {
  db.update(schema.runSteps).set(patch).where(eq(schema.runSteps.id, rowId)).run()
}

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

export function appendLog(runId: number, text: string): void {
  db.update(schema.runs)
    .set({ log: sql`${schema.runs.log} || ${text}` })
    .where(eq(schema.runs.id, runId))
    .run()
}

// Other writers append outside this module. Cast to blob: sqlite's length()
// on TEXT counts characters while the dashboard cuts the log in bytes.
export function runLogBytes(runId: number): number {
  return db
    .select({ bytes: sql<number>`length(cast(${schema.runs.log} as blob))` })
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
    .get()?.bytes ?? 0
}

function finish(runId: number, status: 'success' | 'failed' | 'cancelled'): void {
  db.update(schema.runs)
    .set({ status, finishedAt: new Date() })
    .where(eq(schema.runs.id, runId))
    .run()
}

// The integration's own write-back on the object (a ticket gets the PR link as a comment);
// the workflow's replies toggle covers it like every other reply.
async function notifyRunFinished(runId: number, project: Project, session: Session, status: 'success' | 'failed', log: (text: string) => void): Promise<void> {
  const object = sessionObject(session)
  const run = getRun(runId)
  if (!object || !run) return
  const integration = getIntegration(object.integration)
  if (!integration.runResult) return
  if (status === 'success' && !run.prUrl) return
  // The agent's own reply already says what happened.
  if (status === 'success' && agentRepliedSince(session.id, run.startedAt ?? run.createdAt)) return
  const workflow = run.workflowId ? getWorkflowRow(run.workflowId) : undefined
  if (workflow && !workflow.repliesEnabled) return
  try {
    const { noun } = integration.runResult
    await integration.capabilities.comment(project, object, status === 'success'
      ? `Knecht opened a pull request for this ${noun}: ${run.prUrl}`
      : `Knecht could not finish the run for this ${noun}: ${dashboardOrigin()}${runWorkspacePath(project.id, run.id)}`)
  }
  catch (e) {
    log(`Could not report the result on ${describeObject(object)}: ${(e as Error).message}\n`)
  }
}
