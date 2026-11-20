import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertAiKeyAccepted } from '#server/utils/ai-key'

const answer = (status: number) => {
  const calls: { url: string, headers: Record<string, string> }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> })
    return new Response('{}', { status })
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('assertAiKeyAccepted', () => {
  it('asks each provider with its own auth header', async () => {
    const calls = answer(200)
    await assertAiKeyAccepted('anthropic', 'eu', 'sk-ant')
    await assertAiKeyAccepted('opencode-go', 'eu', 'oc')
    await assertAiKeyAccepted('langdock', 'us', 'ld')
    expect(calls).toEqual([
      { url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': 'sk-ant', 'anthropic-version': '2023-06-01' } },
      { url: 'https://opencode.ai/zen/go/v1/models', headers: { Authorization: 'Bearer oc' } },
      { url: 'https://api.langdock.com/openai/us/v1/models', headers: { Authorization: 'Bearer ld' } },
    ])
  })

  it('rejects a key the provider refuses', async () => {
    answer(401)
    await expect(assertAiKeyAccepted('openai', 'eu', 'sk-x')).rejects.toMatchObject({ statusCode: 400, statusMessage: 'Key rejected by OpenAI.' })
    answer(400)
    await expect(assertAiKeyAccepted('google', 'eu', 'g')).rejects.toMatchObject({ statusMessage: 'Key rejected by Google.' })
  })

  it('lets the key through when the provider is down or unreachable', async () => {
    answer(503)
    await expect(assertAiKeyAccepted('anthropic', 'eu', 'sk-ant')).resolves.toBeUndefined()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    await expect(assertAiKeyAccepted('anthropic', 'eu', 'sk-ant')).resolves.toBeUndefined()
  })
})
