import { aiOutputFields } from '#shared/utils/workflow'
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
    { key: 'system', label: 'System prompt', input: 'textarea', rows: 3, vars: true, placeholder: 'Optional. Merged with the sandbox\'s built-in instructions.' },
    { key: 'output', label: 'Output format', input: 'textarea', rows: 3, placeholder: 'Optional. One field per line:\nprTitle: string\nlabels: string[]' },
    { key: 'model', label: 'Model', input: 'model', placeholder: 'Default from Settings → Agent' },
  ],
  outputs: [
    { path: 'text', hint: 'The agent\'s output' },
    { path: 'json', hint: 'When Output format is set, the validated result; otherwise the output parsed as JSON if it is valid JSON' },
  ],
  // Each declared output field becomes its own steps.<id>.json.<field> variable.
  dynamicOutputs: step => aiOutputFields(step.output ?? '').map(f => ({
    path: `json.${f.name}`,
    hint: `${f.name} (${f.type}) from the output format`,
  })),
  make: () => ({ type: 'ai', prompt: '' }),
  meta: step => ({ detail: step.prompt }),
})
