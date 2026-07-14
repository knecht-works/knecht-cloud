import type { Step } from '#shared/utils/workflow'
import type { StepKind } from '~/utils/dashboard'

// The client-side step definition: ONE file per step type under
// app/utils/steps/ carries everything the editor and the overviews know about
// it: identity (label/kind/icon/group), the settings fields the inspector
// renders, defaults, the variables it contributes to later steps, and how a
// step instance presents in lists. The server pairs each def with an action
// module (server/workflows/actions/<type>.ts) holding schema + execution.

export interface StepField {
  /** Property on the step object this field edits. */
  key: string
  label: string
  /** 'code' renders WorkflowCodeEditor (prism-code-editor); set `lang`. */
  input: 'text' | 'textarea' | 'switch' | 'model' | 'code'
  /** The language a 'code' field highlights and auto-indents as. */
  lang?: 'javascript' | 'bash'
  /** Muted helper text rendered below the field (keep labels short). */
  hint?: string
  placeholder?: string
  required?: boolean
  rows?: number
  /** Field supports {{ }} templating (gets autocomplete + chip inserts). */
  vars?: boolean
}

// A variable a step contributes to the run context for later steps.
export interface StepVar {
  /** Output name relative to the step, e.g. 'name' → {{ steps.<id>.name }} */
  path: string
  hint: string
}

// How a step instance presents in lists (builder rail, workflow overview).
export interface StepMeta {
  icon: string
  kind: StepKind
  label: string
  detail: string
}

export interface StepDef<T extends Step['type']> {
  type: T
  label: string
  hint: string
  kind: StepKind
  icon: string
  group: string
  fields: StepField[]
  /** Variables this step writes into the run context for LATER steps. */
  outputs: StepVar[]
  /**
   * Instance-derived outputs, appended to `outputs` (e.g. the ai step exposing
   * each declared output field as steps.<id>.json.<field>). Kept separate from
   * the static list so most steps ignore it.
   */
  dynamicOutputs?(step: Extract<Step, { type: T }>): StepVar[]
  make(): Extract<Step, { type: T }>
  /**
   * Instance-specific presentation, merged over the def's icon/kind/label
   * (e.g. bash showing the command as detail, or picking a composer icon).
   */
  meta?(step: Extract<Step, { type: T }>): Partial<StepMeta>
}

// The type-erased form the registry holds: callers only ever have a plain
// `Step` in hand (Extract<Step, { type: union }> collapses back to Step).
// `defineStep` is the single point where the narrowing cast happens; def
// modules stay fully typed against their own step shape.
export type RegisteredStepDef = StepDef<Step['type']>

export function defineStep<T extends Step['type']>(def: StepDef<T>): RegisteredStepDef {
  return def as unknown as RegisteredStepDef
}
