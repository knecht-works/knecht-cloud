import { z } from 'zod'
import { tryParseJson } from '../../utils/json'
import { defineAction, ActionError } from './types'

// A generic HTTP request from the host (notify a Slack webhook, hit an API).
// Members are fully trusted on this single-tenant instance (they already run
// arbitrary bash in sandboxes), so no egress filtering is applied here.
const MAX_BODY_CHARS = 48_000

export const httpAction = defineAction({
  type: 'http',
  params: {
    method: z.string().regex(/^(GET|POST|PUT|PATCH|DELETE|HEAD)$/i, 'GET, POST, PUT, PATCH, DELETE or HEAD').default('GET'),
    // Templated ({{ }}), so URL-validity is a runtime concern, not a save-time one.
    url: z.string().min(1),
    // One "Name: value" per line.
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

    // Big responses are truncated instead of failing the 64 KB output cap —
    // an API you call is not obliged to answer small.
    const body = text.length > MAX_BODY_CHARS
      ? text.slice(0, MAX_BODY_CHARS)
      : tryParseJson(text) ?? text
    const outputs = { status: res.status, body }
    if (!res.ok) throw new ActionError(`HTTP ${res.status} from ${step.url}`, outputs)
    return outputs
  },
})
