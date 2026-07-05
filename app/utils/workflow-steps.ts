// The client-side step registry — the ONE place that describes a step type for
// the editor: identity (icon/label/kind), its settings fields (rendered by the
// inspector), defaults, and validation. The variables a step contributes live
// in the shared model (STEP_OUTPUTS, shared/utils/workflow.ts) so the engine
// and the editor can't drift; the server side pairs this registry with an
// action module (server/workflows/actions).

import { STEP_OUTPUTS, type StepVar } from '#shared/utils/workflow'

export type { StepVar }

export interface StepField {
  /** Property on the step object this field edits. */
  key: string
  label: string
  input: 'text' | 'textarea' | 'switch'
  placeholder?: string
  required?: boolean
  rows?: number
  /** Field supports {{ }} templating (gets autocomplete + chip inserts). */
  vars?: boolean
}

export interface StepDef {
  type: WorkflowStep['type']
  label: string
  hint: string
  kind: StepKind
  icon: string
  group: string
  fields: StepField[]
  make: () => WorkflowStep
}

export const STEP_DEFS: StepDef[] = [
  {
    type: 'ddev-start',
    label: 'Boot project',
    hint: 'Start the ddev stack + import the DB',
    kind: 'det',
    icon: 'i-lucide-play',
    group: 'Deterministic',
    fields: [],
    make: () => ({ type: 'ddev-start' }),
  },
  {
    type: 'bash',
    label: 'Shell command',
    hint: 'Run a command inside the sandbox',
    kind: 'det',
    icon: 'i-lucide-terminal',
    group: 'Deterministic',
    fields: [
      { key: 'command', label: 'Command', input: 'textarea', rows: 2, required: true, vars: true, placeholder: 'ddev composer install' },
      { key: 'continueOnError', label: 'Continue on error', input: 'switch' },
    ],
    make: () => ({ type: 'bash', command: '', continueOnError: false }),
  },
  {
    type: 'create-branch',
    label: 'Create branch',
    hint: 'Branch off the current checkout',
    kind: 'out',
    icon: 'i-lucide-git-branch',
    group: 'Output',
    fields: [
      { key: 'name', label: 'Branch name', input: 'text', required: true, vars: true, placeholder: 'knecht/{{ run.id }}' },
    ],
    make: () => ({ type: 'create-branch', name: '' }),
  },
  {
    type: 'create-commit',
    label: 'Create commit',
    hint: 'Commit everything the run changed',
    kind: 'out',
    icon: 'i-lucide-git-commit-horizontal',
    group: 'Output',
    fields: [
      { key: 'message', label: 'Commit message', input: 'text', required: true, vars: true, placeholder: 'Automated change' },
    ],
    make: () => ({ type: 'create-commit', message: '' }),
  },
  {
    type: 'create-pr',
    label: 'Pull request',
    hint: 'Push the branch and open a PR',
    kind: 'out',
    icon: 'i-lucide-git-pull-request',
    group: 'Output',
    fields: [
      { key: 'title', label: 'Title', input: 'text', required: true, vars: true, placeholder: 'Knecht change' },
      { key: 'body', label: 'Description', input: 'textarea', rows: 3, vars: true, placeholder: 'What this PR changes — {{ preview.url }} links the live preview.' },
    ],
    make: () => ({ type: 'create-pr', title: '', body: '' }),
  },
]

export function stepDef(type: WorkflowStep['type']): StepDef {
  return STEP_DEFS.find(d => d.type === type)!
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

// Everything a step at `index` can reference: the run context plus the outputs
// of every step BEFORE it — the n8n model, values flow front to back.
export function availableVars(steps: WorkflowStep[], index: number): VarGroup[] {
  const groups: VarGroup[] = [{ label: 'Context', vars: CONTEXT_VARS }]
  steps.slice(0, index).forEach((step, i) => {
    const outputs = STEP_OUTPUTS[step.type]
    if (outputs.length) {
      groups.push({ label: `${i + 1} · ${workflowStepMeta(step).label}`, vars: outputs })
    }
  })
  return groups
}

// A step is saveable when its required fields are filled.
export function stepValid(step: WorkflowStep): boolean {
  const s = step as unknown as Record<string, unknown>
  return stepDef(step.type).fields.every(f =>
    !f.required || !!String(s[f.key] ?? '').trim())
}
