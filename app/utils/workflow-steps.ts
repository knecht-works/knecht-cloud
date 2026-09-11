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

// Registry order is the library order in the UI.
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

export function stepDefFor(type: string): RegisteredStepDef | undefined {
  return BY_TYPE.get(type as WorkflowStep['type'])
}

export function stepDef(type: WorkflowStep['type']): RegisteredStepDef {
  return BY_TYPE.get(type)!
}

export function makeStep(type: WorkflowStep['type'], steps: WorkflowStep[]): WorkflowStep {
  const def = stepDef(type)
  return { ...def.make(), id: deriveStepId(def.label, stepIds(steps)) }
}

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

const CONTEXT_VARS: StepVar[] = [
  { path: 'run.id', hint: 'This run\'s number' },
  { path: 'run.url', hint: 'Link to this run in the dashboard' },
  { path: 'project.name', hint: 'Repo name' },
  { path: 'project.owner', hint: 'Repo owner' },
  { path: 'project.fullName', hint: 'owner/name' },
  { path: 'project.defaultBranch', hint: 'The default branch' },
]

export const TRIGGER_VARS: StepVar[] = [
  { path: 'inputs.title', hint: 'Issue/PR title, or the commit message' },
  { path: 'inputs.body', hint: 'Issue/PR body' },
  { path: 'inputs.identifier', hint: 'Issue/PR number, commit sha, ticket key' },
  { path: 'inputs.url', hint: 'Link to the issue, PR or commit' },
  { path: 'inputs.event', hint: 'e.g. push, pull_request, issues' },
]

export interface VarGroup {
  label: string
  color: string
  vars: StepVar[]
}

export function varPathParts(path: string): [string, string] {
  const at = path.lastIndexOf('.')
  return [path.slice(0, at + 1), path.slice(at + 1)]
}

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

export const LOOP_VARS: VarGroup = {
  label: 'Loop',
  color: STEP_KIND_COLOR.flow,
  vars: [
    { path: 'loop.item', hint: 'The current item' },
    { path: 'loop.index', hint: 'The current index (0-based)' },
  ],
}

export function stepOutputGroups(steps: WorkflowStep[], index: number): VarGroup[] {
  const groups: VarGroup[] = []
  steps.slice(0, index).forEach((step, i) => {
    const group = stepOutputGroup(step, i + 1)
    if (group) groups.push(group)
  })
  return groups
}

export function availableVars(steps: WorkflowStep[], index: number): VarGroup[] {
  return [...baseVarGroups(), ...stepOutputGroups(steps, index)]
}

export function baseVarGroups(): VarGroup[] {
  return [
    { label: 'Context', color: STEP_KIND_COLOR.trigger, vars: CONTEXT_VARS },
    { label: 'Trigger event', color: STEP_KIND_COLOR.trigger, vars: TRIGGER_VARS },
  ]
}

export interface StepIssue {
  step: WorkflowStep
  message: string
}

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

export function workflowRunnable(w: { steps: WorkflowStep[], draftSteps: WorkflowStep[] | null }): boolean {
  const steps = w.draftSteps ?? w.steps
  return steps.length > 0 && steps.every(stepValid)
}

export const FORCE_STEP_ISSUES: InjectionKey<Ref<boolean>> = Symbol('force-step-issues')

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
