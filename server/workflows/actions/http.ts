import { z } from 'zod'
import { tryParseJson } from '../../utils/json'
import { defineAction, ActionError } from './types'

// No egress filtering: members already run arbitrary bash in sandboxes.
const MAX_BODY_CHARS = 48_000

export const httpAction = defineAction({
  type: 'http',
  params: {
    method: z.string().regex(/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/i, 'GET, POST, PUT, PATCH, DELETE or HEAD').default('GET'),
    url: z.string().min(1),
    headers: z.string().optional(),
    body: z.string().optional(),
  },
  async run(step, rt) {
    const method = step.method.toUpperCase()
    rt.log(`\n▶ http: ${method} ${step.url}\n`)

    const headers: Record<string, string> = {}
    for (const line of (step.headers ?? '').split('\n')) {
      const sep = line.indexOf(':')
      if (sep > 0) headers[line.slice(0, sep).trim()] = line.slice(sep + 1).trim()
    }

    const res = await fetch(step.url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : (step.body || undefined),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    rt.log(`← ${res.status} (${text.length} chars)\n`)

    const body = text.length > MAX_BODY_CHARS
      ? text.slice(0, MAX_BODY_CHARS)
      : tryParseJson(text) ?? text
    const outputs = { status: res.status, body }
    if (!res.ok) throw new ActionError(`HTTP ${res.status} from ${step.url}`, outputs)
    return outputs
  },
})
