import { defineStep } from './define'

export const ifStep = defineStep({
  type: 'if',
  label: 'If / else',
  hint: 'Branch on conditions',
  kind: 'flow',
  icon: 'i-lucide-git-fork',
  group: 'Control flow',
  fields: [],
  outputs: [
    { path: 'matched', hint: 'Whether the conditions matched (then ran)' },
  ],
  make: () => ({ type: 'if', conditions: [[{ left: '', op: 'eq', right: '' }]], then: [], else: [] }),
  meta: (step) => {
    const conditions = step.conditions.flat().length
    const steps = step.then.length + step.else.length
    return { detail: `${conditions} condition${conditions === 1 ? '' : 's'} · ${steps} step${steps === 1 ? '' : 's'}` }
  },
})
