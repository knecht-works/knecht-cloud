import { z } from 'zod'
import { tryParseJson } from '#server/utils/json'
import { render, textAt, valueAt, type RunContext } from '#server/workflows/context'
import { defineAction, ActionError } from '#server/workflows/actions/types'

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
  templateParams: ['body'],
  async run(step, rt) {
    const method = step.method.toUpperCase()
    rt.log(`\n▶ http: ${method} ${step.url}\n`)

    const headers: Record<string, string> = {}
    for (const line of (step.headers ?? '').split('\n')) {
      const sep = line.indexOf(':')
      if (sep > 0) headers[line.slice(0, sep).trim()] = line.slice(sep + 1).trim()
    }

    const sendsBody = method !== 'GET' && method !== 'HEAD'
    const body = step.body && sendsBody ? renderBody(step.body, headers, rt.ctx) : undefined

    const res = await fetch(step.url, {
      method,
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    rt.log(`← ${res.status} (${text.length} chars)\n`)

    const outputs = {
      status: res.status,
      body: text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : tryParseJson(text) ?? text,
    }
    if (!res.ok) throw new ActionError(`HTTP ${res.status} from ${step.url}`, outputs)
    return outputs
  },
})

function renderBody(template: string, headers: Record<string, string>, ctx: RunContext): string {
  const contentType = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type')?.[1]
  const sniffed = !contentType && /^\s*(\[|\{(?!\{))/.test(template)
  if (!sniffed && !(contentType && /\bjson\b/i.test(contentType))) return render(template, ctx)
  const body = renderJson(template, ctx)
  try {
    JSON.parse(body)
  }
  catch (e) {
    if (sniffed) return render(template, ctx)
    throw new ActionError(`Request body is not valid JSON: ${(e as Error).message}`)
  }
  return body
}

const REF_RE = /\{\{\s*([\w.]+)\s*\}\}/y

function renderJson(template: string, ctx: RunContext): string {
  let out = ''
  let inString = false
  for (let i = 0; i < template.length;) {
    REF_RE.lastIndex = i
    const ref = REF_RE.exec(template)
    if (ref) {
      out += inString ? JSON.stringify(textAt(ref[1]!, ctx)).slice(1, -1) : jsonValue(valueAt(ref[1]!, ctx))
      i += ref[0].length
      continue
    }
    const c = template[i]!
    const len = inString && c === '\\' ? 2 : 1
    if (c === '"') inString = !inString
    out += template.slice(i, i + len)
    i += len
  }
  return out
}

function jsonValue(value: unknown): string {
  if (value == null) return 'null'
  if (typeof value !== 'string') return JSON.stringify(value)
  const parsed = tryParseJson(value)
  return JSON.stringify(parsed === undefined ? value : parsed)
}
