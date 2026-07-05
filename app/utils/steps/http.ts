import { defineStep } from './define'

export const httpStep = defineStep({
  type: 'http',
  label: 'HTTP request',
  hint: 'Call an external API or webhook',
  kind: 'det',
  icon: 'i-lucide-globe',
  group: 'Deterministic',
  fields: [
    { key: 'method', label: 'Method', input: 'text', required: true, placeholder: 'GET' },
    { key: 'url', label: 'URL', input: 'text', required: true, vars: true, placeholder: 'https://example.com/api' },
    { key: 'headers', label: 'Headers (one "Name: value" per line)', input: 'textarea', rows: 2, vars: true },
    { key: 'body', label: 'Body', input: 'textarea', rows: 3, vars: true },
  ],
  outputs: [
    { path: 'status', hint: 'The HTTP status code' },
    { path: 'body', hint: 'The response body (parsed JSON when possible)' },
  ],
  make: () => ({ type: 'http', method: 'GET', url: '' }),
  meta: step => ({ detail: `${step.method.toUpperCase()} ${step.url}` }),
})
