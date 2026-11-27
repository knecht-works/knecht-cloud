import { describe, expect, it } from 'vitest'
import { httpAction } from '#server/workflows/actions/http'
import { ActionError } from '#server/workflows/actions'
import type { RunContext } from '#server/workflows/context'
import type { Step } from '#shared/utils/workflow'
import { bareRuntime } from '../helpers/action-rt'
import { withServer } from '../helpers/http-server'

const step = (params: Partial<Extract<Step, { type: 'http' }>>): Extract<Step, { type: 'http' }> =>
  ({ type: 'http', id: 'req', method: 'GET', url: '', ...params })

const TITLE = `'; $(echo INJECTED) "`

function runtimeWith(inputs: Record<string, string>, steps: RunContext['steps'] = {}) {
  return { ...bareRuntime(), ctx: { run: { id: 7, url: '' }, project: {}, inputs, steps } as RunContext }
}

describe('http action', () => {
  it('parses header lines, sends the body and returns parsed JSON', async () => {
    await withServer({
      'POST /hook': (req, res, body) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ got: JSON.parse(body), auth: req.headers.authorization ?? null }))
      },
    }, async (origin) => {
      const outputs = await httpAction.run(step({
        method: 'post',
        url: `${origin}/hook`,
        headers: 'Authorization: Bearer abc\nnot a header line\n',
        body: '{"run": 7}',
      }), bareRuntime())
      expect(outputs).toEqual({ status: 200, body: { got: { run: 7 }, auth: 'Bearer abc' } })
    })
  })

  it('keeps a non-JSON response as text', async () => {
    await withServer({
      'GET /plain': (_req, res) => res.end('plain text'),
    }, async (origin) => {
      const outputs = await httpAction.run(step({ url: `${origin}/plain` }), bareRuntime())
      expect(outputs).toEqual({ status: 200, body: 'plain text' })
    })
  })

  it('fails on an error status but keeps the response referencable', async () => {
    await withServer({
      'GET /broken': (_req, res) => {
        res.statusCode = 503
        res.end(JSON.stringify({ reason: 'maintenance' }))
      },
    }, async (origin) => {
      const error = await httpAction.run(step({ url: `${origin}/broken` }), bareRuntime()).catch(e => e as ActionError)
      expect(error).toBeInstanceOf(ActionError)
      expect((error as ActionError).message).toContain('HTTP 503')
      expect((error as ActionError).outputs).toEqual({ status: 503, body: { reason: 'maintenance' } })
    })
  })

  it.each([
    ['with a JSON content type', 'Content-Type: application/json'],
    ['without a content type', undefined],
  ])('sends valid JSON with a ticket title inside a JSON string %s', async (_name, headers) => {
    let received = ''
    await withServer({
      'POST /hook': (_req, res, body) => res.end(received = body),
    }, async (origin) => {
      await httpAction.run(step({
        method: 'POST',
        url: `${origin}/hook`,
        headers,
        body: '{"title": "{{ inputs.title }}", "text": "Ticket: {{ inputs.title }}"}',
      }), runtimeWith({ title: TITLE }))
    })
    expect(JSON.parse(received)).toEqual({ title: TITLE, text: `Ticket: ${TITLE}` })
  })

  it('inserts a value outside a JSON string as exactly one JSON value', async () => {
    let received = ''
    await withServer({
      'POST /hook': (_req, res, body) => res.end(received = body),
    }, async (origin) => {
      await httpAction.run(step({
        method: 'POST',
        url: `${origin}/hook`,
        body: '{"title": {{ inputs.title }}, "count": {{ steps.c.stdout }}, "data": {{ steps.c.json }}, "none": {{ steps.nope }}}',
      }), runtimeWith({ title: '1, "admin": true' }, { c: { stdout: '42', json: { a: [1] } } }))
    })
    expect(JSON.parse(received)).toEqual({ title: '1, "admin": true', count: 42, data: { a: [1] }, none: null })
  })

  it('fails without sending when a JSON body is not valid JSON', async () => {
    let calls = 0
    await withServer({
      'POST /hook': (_req, res) => res.end(String(++calls)),
    }, async (origin) => {
      const error = await httpAction.run(step({
        method: 'POST',
        url: `${origin}/hook`,
        headers: 'Content-Type: application/json',
        body: '{"title": "{{ inputs.title }}",}',
      }), runtimeWith({ title: TITLE })).catch(e => e as Error)
      expect(error).toBeInstanceOf(ActionError)
      expect((error as Error).message).toMatch(/not valid JSON/)
    })
    expect(calls).toBe(0)
  })

  it('sends a non-JSON body as plain text', async () => {
    let received = ''
    await withServer({
      'POST /hook': (_req, res, body) => res.end(received = body),
    }, async (origin) => {
      await httpAction.run(step({
        method: 'POST',
        url: `${origin}/hook`,
        headers: 'Content-Type: text/plain',
        body: 'title={{ inputs.title }}',
      }), runtimeWith({ title: TITLE }))
      expect(received).toBe(`title=${TITLE}`)
      await httpAction.run(step({ method: 'POST', url: `${origin}/hook`, body: '{{ inputs.title }}' }), runtimeWith({ title: TITLE }))
      expect(received).toBe(TITLE)
      await httpAction.run(step({ method: 'POST', url: `${origin}/hook`, body: '[Knecht] {{ inputs.title }}' }), runtimeWith({ title: TITLE }))
      expect(received).toBe(`[Knecht] ${TITLE}`)
    })
  })
})
