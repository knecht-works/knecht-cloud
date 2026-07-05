import { defineStep } from './define'

export const createCommitStep = defineStep({
  type: 'create-commit',
  label: 'Create commit',
  hint: 'Commit everything the run changed',
  kind: 'out',
  icon: 'i-lucide-git-commit-horizontal',
  group: 'Output',
  fields: [
    { key: 'message', label: 'Commit message', input: 'text', required: true, vars: true, placeholder: 'Automated change' },
  ],
  outputs: [
    { path: 'sha', hint: 'The commit\'s SHA (empty when nothing changed)' },
  ],
  make: () => ({ type: 'create-commit', message: '' }),
  meta: step => ({ detail: step.message }),
})
