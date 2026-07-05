import type { z } from 'zod'
import type { Project } from '../../db/schema'
import type { Step } from '../../../shared/utils/workflow'
import type { RunContext } from '../context'

// The action interface (workflow-engine-plan.md D3): one module per step type
// under server/workflows/actions/, registered in ./index.ts. The runner renders
// a step's params against the run context and invokes `run`; the returned patch
// is merged into the context so later steps can reference the outputs.

// What the runner hands every action. Sandbox operations go through here (they
// need run-scoped wiring like log streaming); pure integrations (git, GitHub)
// are imported by the action modules directly.
export interface ActionRuntime {
  runId: number
  project: Project
  /** Host-side path of the run's isolated git checkout. */
  checkoutDir: string
  /** The full run context — for reads beyond the step's own rendered params. */
  ctx: RunContext
  /** Append to the run log. */
  log: (text: string) => void
  sandbox: {
    /** Boot the run's sandbox if it isn't up. */
    ensureUp: () => Promise<void>
    /**
     * Run a command in the sandbox, streaming output into the run log.
     * Resolves with the exit code and the captured output tail (stdout+stderr
     * merged, size-capped) — never rejects on a non-zero exit.
     */
    stream: (command: string[]) => Promise<{ code: number, tail: string }>
    /** Copy a host file into the sandbox. */
    copyIn: (hostPath: string, sandboxPath: string) => Promise<void>
  }
}

// An action can attach outputs to a thrown error (bash: exit code + output
// tail; http: the error response). The runner records them on the failed
// run_steps row and — with continueOnError — still exposes them to later steps,
// so conditions like `{{ steps.<id>.exitCode }}` work on failure.
export class ActionError extends Error {
  outputs?: Record<string, unknown>
  constructor(message: string, outputs?: Record<string, unknown>) {
    super(message)
    this.outputs = outputs
  }
}

export interface ActionDef<T extends Step['type']> {
  type: T
  /** Zod shape of the step's own params — `type` and step meta are added by the schema assembler. */
  params: z.ZodRawShape
  /** The step's YAML authoring form (bare string or single-key object) → normalized Step. */
  yaml: z.ZodType<Step>
  /**
   * Pre-step-id templates referenced this action's outputs under a fixed
   * top-level context key ({{ branch.name }}, {{ pr.url }}). The runner keeps
   * writing outputs there (last step of this type wins — the old behavior)
   * alongside the collision-free steps.<id> namespace.
   */
  legacyKey?: string
  /**
   * Param keys that resolve RAW when their template is exactly one
   * `{{ ref }}`: the referenced value (object/array/number) is passed as-is
   * instead of stringified — how a js step receives a whole output bag.
   */
  rawParams?: readonly string[]
  /**
   * Execute the step. String params arrive already `render()`ed. The returned
   * outputs land in the run context under steps.<id> (and legacyKey, if set) —
   * they're what STEP_OUTPUTS (shared/utils/workflow.ts) describes.
   */
  run(step: Extract<Step, { type: T }>, rt: ActionRuntime): Promise<Record<string, unknown> | undefined>
}

// The type-erased form the registry holds — the runner only ever has a plain
// `Step` in hand. `defineAction` is the single point where the narrowing cast
// happens; action modules stay fully typed against their own step shape.
export interface RegisteredAction {
  type: Step['type']
  params: z.ZodRawShape
  yaml: z.ZodType<Step>
  legacyKey?: string
  rawParams?: readonly string[]
  run(step: Step, rt: ActionRuntime): Promise<Record<string, unknown> | undefined>
}

export function defineAction<T extends Step['type']>(def: ActionDef<T>): RegisteredAction {
  return def as unknown as RegisteredAction
}
