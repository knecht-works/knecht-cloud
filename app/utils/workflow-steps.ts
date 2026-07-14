// The client-side step registry, assembled from one def file per step type
// (app/utils/steps/<type>.ts): each carries the step's complete client-side
// description: identity, editor fields, defaults, outputs and list
// presentation. The server pairs each def with an action module
// (server/workflows/actions/<type>.ts); the shared Step union
// (shared/utils/workflow.ts) is the type-level single source both build on.

import type { InjectionKey, Ref } from 'vue'
import { COMPOSITE_CHILD_KEYS, deriveStepId, isComposite, STEP_META_KEYS, stepChildren, stepIds } from '#shared/utils/workflow'
import type { RegisteredStepDef, StepMeta, StepVar } from '~/utils/steps/define'
import { ddevStartStep } from '~/utils/steps/ddev-start'
import { bashStep } from '~/utils/steps/bash'
import { aiStep } from '~/utils/steps/ai'
import { jsStep } from '~/utils/steps/js'
import { httpStep } from '~/utils/steps/http'
import { linkCheckStep } from '~/utils/steps/link-check'
import { ifStep } from '~/utils/steps/if'
import { loopStep } from '~/utils/steps/loop'
import { createBranchStep } from '~/utils/steps/create-branch'
import { createCommitStep } from '~/utils/steps/create-commit'
import { createPrStep } from '~/utils/steps/create-pr'

export type { RegisteredStepDef, StepField, StepMeta, StepVar } from '~/utils/steps/define'

// Registry order = library order (grouped by `group` in the UI).
export const STEP_DEFS: RegisteredStepDef[] = [
  ddevStartStep,
  bashStep,
  aiStep,
  jsStep,
  httpStep,
  linkCheckStep,
  ifStep,
  loopStep,
  createBranchStep,
  createCommitStep,
  createPrStep,
]

const BY_TYPE = new Map(STEP_DEFS.map(d => [d.type, d]))

// Lookup that tolerates unknown types (a removed step type in an old run's
// records). Callers that render history use this.
export function stepDefFor(type: string): RegisteredStepDef | undefined {
  return BY_TYPE.get(type as WorkflowStep['type'])
}

export function stepDef(type: WorkflowStep['type']): RegisteredStepDef {
  return BY_TYPE.get(type)!
}

// A fresh step for the given type, with its stable id derived from the type's
// label against the steps it's joining (run_command, run_command_2, …): the
// single creation path (library click AND drag-drop).
export function makeStep(type: WorkflowStep['type'], steps: WorkflowStep[]): WorkflowStep {
  const def = stepDef(type)
  return { ...def.make(), id: deriveStepId(def.label, stepIds(steps)) }
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
  { path: 'run.url', hint: 'Link to this run\'s detail page' },
  { path: 'project.name', hint: 'Repo name' },
  { path: 'project.owner', hint: 'Repo owner' },
  { path: 'project.fullName', hint: 'owner/name' },
  { path: 'project.defaultBranch', hint: 'The default branch' },
]

// Event data a trigger seeds the run with (server/utils/github-webhook.ts).
// A FIXED contract across all trigger kinds: the event's subject (issue, PR,
// head commit) fills identifier/title/body/url, so every variable exists for
// every trigger and one workflow serves them all. Empty on manual and
// scheduled runs.
export const TRIGGER_VARS: StepVar[] = [
  { path: 'inputs.title', hint: 'Issue/PR title, or the commit message' },
  { path: 'inputs.body', hint: 'Issue/PR body' },
  { path: 'inputs.identifier', hint: 'Issue/PR number, commit sha, ticket key' },
  { path: 'inputs.url', hint: 'Link to the issue, PR or commit' },
  { path: 'inputs.event', hint: 'e.g. push, pull_request, issues' },
]

export interface VarGroup {
  label: string
  /** Accent for the group's chips: the source step's kind colour. */
  color: string
  vars: StepVar[]
}

// A variable path split for two-tone rendering: the routing prefix
// (`steps.s2.`) drawn dimmed, the final segment (`stdout`) readable. The
// segment is what authors scan for. Used by the chips and the autocomplete.
export function varPathParts(path: string): [string, string] {
  const at = path.lastIndexOf('.')
  return [path.slice(0, at + 1), path.slice(at + 1)]
}

// The {{ steps.<id>.… }} group one prior step contributes, or null when it has
// no outputs (or no id yet).
export function stepOutputGroup(step: WorkflowStep, position: number): VarGroup | null {
  const def = stepDef(step.type)
  const outputs = [...def.outputs, ...(def.dynamicOutputs?.(step) ?? [])]
  if (!outputs.length || !step.id) return null
  const meta = workflowStepMeta(step)
  return {
    label: `${position} · ${meta.label}`,
    color: STEP_KIND_COLOR[meta.kind],
    vars: outputs.map(v => ({ ...v, path: `steps.${step.id}.${v.path}` })),
  }
}

// What a loop's body can additionally reference.
export const LOOP_VARS: VarGroup = {
  label: 'Loop',
  color: STEP_KIND_COLOR.flow,
  vars: [
    { path: 'loop.item', hint: 'The current item' },
    { path: 'loop.index', hint: 'The current index (0-based)' },
  ],
}

// The output groups of the steps BEFORE `index`: the one home for the
// "values flow front to back" scoping rule, shared by the top-level editor
// (availableVars) and composite sub-lists (WorkflowSubSteps).
export function stepOutputGroups(steps: WorkflowStep[], index: number): VarGroup[] {
  const groups: VarGroup[] = []
  steps.slice(0, index).forEach((step, i) => {
    const group = stepOutputGroup(step, i + 1)
    if (group) groups.push(group)
  })
  return groups
}

// Everything a step at `index` can reference: the run context plus the outputs
// of every step BEFORE it. Outputs are offered under the step's stable id
// ({{ steps.<id>.<output> }}), so a step type used twice stays unambiguous.
// (Sub-steps of composites extend this, see WorkflowSubSteps, with the loop
// vars and their prior siblings.)
export function availableVars(steps: WorkflowStep[], index: number): VarGroup[] {
  // Context vars are seeded by the trigger/run: they wear the trigger colour.
  return [
    { label: 'Context', color: STEP_KIND_COLOR.trigger, vars: CONTEXT_VARS },
    { label: 'Trigger event', color: STEP_KIND_COLOR.trigger, vars: TRIGGER_VARS },
    ...stepOutputGroups(steps, index),
  ]
}

// One problem preventing a step from saving, phrased for the editor UI.
// `step` is the step the problem sits on: for a composite that can be one of
// its sub-steps, so the UI can name (and open) the exact offender.
export interface StepIssue {
  step: WorkflowStep
  message: string
}

// Every problem on the step and (for composites) its sub-steps, depth-first:
// what "Incomplete" actually means, spelled out. A step is saveable when its
// required fields are filled, its sub-steps (if any) are valid, and, for an
// if, every condition row is usable.
export function stepIssues(step: WorkflowStep): StepIssue[] {
  const issues: StepIssue[] = []
  if (step.type === 'if') {
    if (!step.conditions.length || step.conditions.some(g => !g.length)) {
      issues.push({ step, message: 'Add at least one condition' })
    }
    else if (step.conditions.some(g => g.some(c => !c.left.trim()))) {
      issues.push({ step, message: 'Fill in the left side of every condition' })
    }
  }
  const s = step as unknown as Record<string, unknown>
  for (const f of stepDef(step.type).fields) {
    if (f.required && !String(s[f.key] ?? '').trim()) {
      issues.push({ step, message: `${f.label} is required` })
    }
  }
  for (const child of stepChildren(step).flat()) issues.push(...stepIssues(child))
  return issues
}

export function stepValid(step: WorkflowStep): boolean {
  return stepIssues(step).length === 0
}

// Provided by the editor page, flipped after a failed explicit save: the
// save click is the fixed validation point, so from then on every component
// drops the pristine grace and highlights all problems.
export const FORCE_STEP_ISSUES: InjectionKey<Ref<boolean>> = Symbol('force-step-issues')

// A step whose own params are all still at their just-added defaults: "not
// configured yet" rather than "broken". The editor holds back such a step's
// error highlights until the user starts filling it in; the save stays
// blocked either way (stepValid). Meta (id/label/note) doesn't count as
// configuring, nor do a composite's sub-step lists (each sub-step has its own
// pristineness).
export function stepPristine(step: WorkflowStep): boolean {
  const defaults = stepDef(step.type).make() as unknown as Record<string, unknown>
  const s = step as unknown as Record<string, unknown>
  const skip = new Set<string>([...STEP_META_KEYS, ...(isComposite(step) ? COMPOSITE_CHILD_KEYS[step.type] : [])])
  for (const key of new Set([...Object.keys(defaults), ...Object.keys(s)])) {
    if (skip.has(key)) continue
    if (JSON.stringify(s[key] ?? null) !== JSON.stringify(defaults[key] ?? null)) return false
  }
  return true
}
