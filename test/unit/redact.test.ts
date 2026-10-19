import { describe, expect, it } from 'vitest'
import { maskSecrets, maskStepSecrets } from '../../server/tools/redact'

describe('maskSecrets', () => {
  it('masks literal header and query values but keeps templated ones', () => {
    expect(maskSecrets({
      url: 'https://x.test/a?token=abc&page={{ inputs.page }}#top',
      headers: 'Authorization: Bearer abc\nX-Key: {{ secrets.key }}',
      body: 'kept',
    })).toEqual({
      url: 'https://x.test/a?token=***&page={{ inputs.page }}#top',
      headers: 'Authorization: ***\nX-Key: {{ secrets.key }}',
      body: 'kept',
    })
  })

  it('masks credentials in the URL userinfo', () => {
    expect(maskSecrets({ url: 'https://user:token@api.test/x?a=1' }).url).toBe('https://***@api.test/x?a=***')
    expect(maskSecrets({ url: 'https://{{ secrets.auth }}@api.test/x' }).url).toBe('https://{{ secrets.auth }}@api.test/x')
  })

  it('masks http steps nested in if and loop', () => {
    const [step] = maskStepSecrets([{
      type: 'loop',
      items: '[]',
      steps: [{ type: 'if', conditions: [], then: [{ type: 'http', method: 'GET', url: 'https://x.test', headers: 'A: b' }], else: [] }],
    }])
    expect(JSON.stringify(step)).toContain('"headers":"A: ***"')
  })
})
