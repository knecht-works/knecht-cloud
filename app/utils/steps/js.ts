import { defineStep } from './define'

export const jsStep = defineStep({
  type: 'js',
  label: 'JavaScript',
  hint: 'Run a script inside the sandbox',
  kind: 'det',
  icon: 'i-lucide-braces',
  group: 'Deterministic',
  fields: [
    { key: 'code', label: 'Code: define main(input), return a JSON value', input: 'textarea', rows: 6, required: true, placeholder: 'function main(input) {\n  return { ok: true }\n}' },
    { key: 'input', label: 'Input', input: 'text', vars: true, placeholder: '{{ steps.s1.result }}: a single reference passes the raw value' },
  ],
  outputs: [
    { path: 'result', hint: 'What main() returned' },
  ],
  make: () => ({ type: 'js', code: '' }),
  meta: step => ({ detail: step.code.split('\n')[0] ?? '' }),
})
