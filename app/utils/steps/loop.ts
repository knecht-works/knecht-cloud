import { defineStep } from './define'

export const loopStep = defineStep({
  type: 'loop',
  label: 'Loop',
  hint: 'Repeat steps per item or N times',
  kind: 'flow',
  icon: 'i-lucide-repeat',
  group: 'Control flow',
  fields: [
    { key: 'items', label: 'Items — an array reference or a number', input: 'text', required: true, vars: true, placeholder: '{{ steps.s1.result }} or 3' },
  ],
  outputs: [
    { path: 'results', hint: 'Per-iteration outputs of the loop\'s steps' },
    { path: 'count', hint: 'How many iterations ran' },
  ],
  make: () => ({ type: 'loop', items: '', steps: [] }),
  meta: step => ({ detail: step.items }),
})
