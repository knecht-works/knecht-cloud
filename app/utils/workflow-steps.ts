// The client-side step registry, assembled from one def file per step type
// (app/utils/steps/<type>.ts) — each carries the step's complete client-side
// description: identity, editor fields, defaults, outputs and list
// presentation. The server pairs each def with an action module
// (server/workflows/actions/<type>.ts); the shared Step union
// (shared/utils/workflow.ts) is the type-level single source both build on.

import { nextStepId } from '#shared/utils/workflow'
import type { RegisteredStepDef, StepMeta, StepVar } from '~/utils/steps/define'
import { ddevStartStep } from '~/utils/steps/ddev-start'
import { bashStep } from '~/utils/steps/bash'
import { aiStep } from '~/utils/steps/ai'
import { jsStep } from '~/utils/steps/js'
import { httpStep } from '~/utils/steps/http'
import { ifStep } from '~/utils/steps/if'
import { loopStep } from '~/utils/steps/loop'
import { createBranchStep } from '~/utils/steps/create-branch'
import { createCommitStep } from '~/utils/steps/create-commit'
import { createPrStep } from '~/utils/steps/create-pr'

export type { RegisteredStepDef, StepDef, StepField, StepMeta, StepVar } from '~/utils/steps/define'

// Registry order = library order (grouped by `group` in the UI).
export const STEP_DEFS: RegisteredStepDef[] = [
  ddevStartStep,
  bashStep,
  aiStep,
  jsStep,
  httpStep,
  ifStep,
  loopStep,
  createBranchStep,
  createCommitStep,
  createPrStep,
]

export function stepDef(type: WorkflowStep['type']): RegisteredStepDef {
  return STEP_DEFS.find(d => d.type === type)!
}

// A fresh step for the given type, with its stable id assigned against the
// steps it's joining — the single creation path (library click AND drag-drop).
export function makeStep(type: WorkflowStep['type'], steps: WorkflowStep[]): WorkflowStep {
  return { ...stepDef(type).make(), id: nextStepId(steps) }
}

// How a step instance presents in lists: the def's identity, overlaid with its
// instance-specific derivation (def.meta) and the user's custom label/note.
export function workflowStepMeta(step: WorkflowStep): StepMeta {
  const def = stepDef(step.type)
  const derived = def.meta?.(step) ?? {}
  return {
    icon: derived.icon ?? def.icon,
    kind: derived.kind ?? def.kind,
    label: step.label?.trim() || derived.label || def.label,
    detail: step.description?.trim() || derived.detail || '',
  }
}

// Variables seeded into every run before the first step (workflows/context.ts).
const CONTEXT_VARS: StepVar[] = [
  { path: 'run.id', hint: 'This run\'s number' },
  { path: 'project.name', hint: 'Repo name' },
  { path: 'project.owner', hint: 'Repo owner' },
  { path: 'project.fullName', hint: 'owner/name' },
  { path: 'project.defaultBranch', hint: 'The default branch' },
]

export interface VarGroup {
  label: string
  vars: StepVar[]
}

// The {{ steps.<id>.… }} group one prior step contributes, or null when it has
// no outputs (or no id yet).
export function stepOutputGroup(step: WorkflowStep, position: number): VarGroup | null {
  const outputs = stepDef(step.type).outputs
  if (!outputs.length || !step.id) return null
  return {
    label: `${position} · ${workflowStepMeta(step).label}`,
    vars: outputs.map(v => ({ ...v, path: `steps.${step.id}.${v.path}` })),
  }
}

// What a loop's body can additionally reference.
export const LOOP_VARS: VarGroup = {
  label: 'Loop',
  vars: [
    { path: 'loop.item', hint: 'The current item' },
    { path: 'loop.index', hint: 'The current index (0-based)' },
  ],
}

// Everything a step at `index` can reference: the run context plus the outputs
// of every step BEFORE it — values flow front to back. Outputs are offered
// under the step's stable id ({{ steps.<id>.<output> }}), so a step type used
// twice stays unambiguous. (Sub-steps of composites extend this — see
// WorkflowSubSteps — with the loop vars and their prior siblings.)
export function availableVars(steps: WorkflowStep[], index: number): VarGroup[] {
  const groups: VarGroup[] = [{ label: 'Context', vars: CONTEXT_VARS }]
  steps.slice(0, index).forEach((step, i) => {
    const group = stepOutputGroup(step, i + 1)
    if (group) groups.push(group)
  })
  return groups
}

// A step is saveable when its required fields are filled; composites also need
// at least one usable condition (if) and valid sub-steps throughout.
export function stepValid(step: WorkflowStep): boolean {
  if (step.type === 'if') {
    const conditionsOk = step.conditions.length > 0
      && step.conditions.every(g => g.length > 0 && g.every(c => !!c.left.trim()))
    return conditionsOk && [...step.then, ...step.else].every(stepValid)
  }
  if (step.type === 'loop' && !step.steps.every(stepValid)) return false
  const s = step as unknown as Record<string, unknown>
  return stepDef(step.type).fields.every(f =>
    !f.required || !!String(s[f.key] ?? '').trim())
}
