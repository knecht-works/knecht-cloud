import { defineStep } from './define'

export const createBranchStep = defineStep({
  type: 'create-branch',
  label: 'Create branch',
  hint: 'Branch off the current checkout',
  kind: 'out',
  icon: 'i-lucide-git-branch',
  group: 'Output',
  fields: [
    { key: 'name', label: 'Branch name', input: 'text', required: true, vars: true, placeholder: 'knecht/{{ run.id }}' },
  ],
  outputs: [
    { path: 'name', hint: 'The created branch' },
  ],
  make: () => ({ type: 'create-branch', name: '' }),
  meta: step => ({ detail: step.name }),
})
