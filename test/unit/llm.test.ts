import { describe, expect, it, vi } from 'vitest'
import type { LanguageModel } from 'ai'

vi.mock('../../server/utils/settings', () => ({ getSettings: () => ({}) }))

const { createLanguageModel } = await import('../../server/utils/llm')

function sdk(model: LanguageModel): string {
  return (model as { provider: string }).provider
}

const base = { region: 'eu' as const, apiKey: 'k' }

describe('createLanguageModel', () => {
  it('uses each direct provider\'s own SDK', () => {
    expect(sdk(createLanguageModel({ ...base, provider: 'anthropic', model: 'claude-sonnet-5' }))).toBe('anthropic.messages')
    expect(sdk(createLanguageModel({ ...base, provider: 'openai', model: 'gpt-5.1' }))).toBe('openai.responses')
    expect(sdk(createLanguageModel({ ...base, provider: 'google', model: 'gemini-2.5-flash' }))).toBe('google.generative-ai')
  })

  it('routes langdock Claude models to the Anthropic endpoint and the rest to OpenAI', () => {
    expect(sdk(createLanguageModel({ ...base, provider: 'langdock', model: 'claude-sonnet-5' }))).toBe('anthropic.messages')
    expect(sdk(createLanguageModel({ ...base, provider: 'langdock', model: 'gpt-5.1' }))).toBe('openai.responses')
  })

  it('routes opencode models by their models.dev SDK', () => {
    const api = 'https://opencode.ai/inference/anthropic/v1'
    expect(sdk(createLanguageModel({ ...base, provider: 'opencode', model: 'claude-sonnet-5', npm: '@ai-sdk/anthropic', api }))).toBe('anthropic.messages')
    expect(sdk(createLanguageModel({ ...base, provider: 'opencode-go', model: 'kimi-k2.5', npm: '@ai-sdk/openai-compatible', api }))).toBe('opencode-go.chat')
    expect(sdk(createLanguageModel({ ...base, provider: 'opencode', model: 'kimi-k2.5', api }))).toBe('opencode.chat')
  })

  it('refuses an opencode model without a models.dev endpoint or with an unsupported SDK', () => {
    expect(() => createLanguageModel({ ...base, provider: 'opencode', model: 'x' })).toThrow(/no endpoint/)
    expect(() => createLanguageModel({ ...base, provider: 'opencode', model: 'codestral', npm: '@ai-sdk/mistral', api: 'https://x' })).toThrow(/@ai-sdk\/mistral/)
  })
})
