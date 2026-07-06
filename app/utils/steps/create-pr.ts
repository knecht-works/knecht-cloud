import { defineStep } from './define'

export const createPrStep = defineStep({
  type: 'create-pr',
  label: 'Pull request',
  hint: 'Push the branch and open a PR',
  kind: 'out',
  icon: 'i-lucide-git-pull-request',
  group: 'Output',
  fields: [
    { key: 'title', label: 'Title', input: 'text', required: true, vars: true, placeholder: 'Knecht change' },
    { key: 'body', label: 'Description', input: 'textarea', rows: 3, vars: true, placeholder: 'What this PR changes. {{ preview.url }} links the live preview.' },
  ],
  outputs: [
    { path: 'url', hint: 'The opened pull request' },
    { path: 'number', hint: 'Its number' },
  ],
  make: () => ({ type: 'create-pr', title: '', body: '' }),
  meta: step => ({ detail: step.title }),
})
