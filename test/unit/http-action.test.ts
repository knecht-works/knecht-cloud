import { describe, expect, it } from 'vitest'
import { httpAction } from '../../server/workflows/actions/http'
import { ActionError } from '../../server/workflows/actions'
import type { Step } from '../../shared/utils/workflow'
import { bareRuntime } from '../helpers/action-rt'
import { withServer } from '../helpers/http-server'

const step = (params: Partial<Extract<Step, { type: 'http' }>>): Extract<Step, { type: 'http' }> =>
  ({ type: 'http', id: 'req', method: 'GET', url: '', ...params })

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
})
