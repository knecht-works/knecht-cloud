import { defineStep } from './define'

export const aiStep = defineStep({
  type: 'ai',
  label: 'AI',
  hint: 'Ask a model via OpenRouter',
  kind: 'ai',
  icon: 'i-lucide-sparkles',
  group: 'AI',
  fields: [
    { key: 'prompt', label: 'Prompt', input: 'textarea', rows: 4, required: true, vars: true, placeholder: 'Summarize this build output: {{ steps.s2.stdout }}' },
    { key: 'system', label: 'System prompt', input: 'textarea', rows: 2, vars: true, placeholder: 'Optional instructions for the model' },
    { key: 'model', label: 'Model', input: 'text', placeholder: 'Default from Settings → Agent' },
  ],
  outputs: [
    { path: 'text', hint: 'The model\'s response' },
    { path: 'json', hint: 'The response parsed as JSON (when it is valid JSON)' },
  ],
  make: () => ({ type: 'ai', prompt: '' }),
  meta: step => ({ detail: step.prompt }),
})
