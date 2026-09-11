import type { Step } from '#shared/utils/workflow'
import type { StepKind } from '~/utils/dashboard'

export interface StepField {
  key: string
  label: string
  input: 'text' | 'textarea' | 'switch' | 'model' | 'code'
  lang?: 'javascript' | 'bash'
  hint?: string
  placeholder?: string
  required?: boolean
  rows?: number
  vars?: boolean
}

export interface StepVar {
  path: string
  hint: string
}

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
  outputs: StepVar[]
  dynamicOutputs?(step: Extract<Step, { type: T }>): StepVar[]
  make(): Extract<Step, { type: T }>
  meta?(step: Extract<Step, { type: T }>): Partial<StepMeta>
}

export type RegisteredStepDef = StepDef<Step['type']>

export function defineStep<T extends Step['type']>(def: StepDef<T>): RegisteredStepDef {
  return def as unknown as RegisteredStepDef
}
