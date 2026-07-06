import { defineStep } from './define'

export const aiStep = defineStep({
  type: 'ai',
  label: 'AI',
  hint: 'Run opencode on the checkout',
  kind: 'ai',
  icon: 'i-lucide-sparkles',
  group: 'AI',
  fields: [
    { key: 'prompt', label: 'Prompt', input: 'textarea', rows: 4, required: true, vars: true, placeholder: 'Fix the failing test: {{ steps.s2.stdout }}' },
    { key: 'model', label: 'Model', input: 'text', placeholder: 'Default from Settings → Agent' },
  ],
  outputs: [
    { path: 'text', hint: 'The agent\'s output' },
    { path: 'json', hint: 'The output parsed as JSON (when it is valid JSON)' },
  ],
  make: () => ({ type: 'ai', prompt: '' }),
  meta: step => ({ detail: step.prompt }),
})
