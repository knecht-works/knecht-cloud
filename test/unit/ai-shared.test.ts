import { describe, expect, it } from 'vitest'
import { MODEL_NAME_RE, stripLegacyModelPrefix } from '../../shared/utils/ai'

// Bare model names (docs/adr/0003): what the store accepts and how legacy
// provider-prefixed values are normalized on their way into the runtime.

describe('MODEL_NAME_RE', () => {
  it('accepts bare, slashed and versioned model names', () => {
    for (const id of ['claude-sonnet-4-5', 'gpt-4o', 'meta-llama/llama-3.3-70b', 'qwen:32b', 'o1']) {
      expect(id).toMatch(MODEL_NAME_RE)
    }
  })

  it('rejects anything that is not shell-safe', () => {
    for (const id of ['', ' claude', 'a b', 'a"b', 'a\'b', '$(id)', '`id`', 'a;b', 'a/', '/a']) {
      expect(id).not.toMatch(MODEL_NAME_RE)
    }
  })
})

describe('stripLegacyModelPrefix', () => {
  it('strips a known provider prefix', () => {
    expect(stripLegacyModelPrefix('anthropic/claude-sonnet-4-5')).toBe('claude-sonnet-4-5')
    expect(stripLegacyModelPrefix('opencode-go/grok-code')).toBe('grok-code')
  })

  it('strips only one level', () => {
    expect(stripLegacyModelPrefix('opencode/anthropic/claude-sonnet-4-5')).toBe('anthropic/claude-sonnet-4-5')
  })

  it('keeps genuinely slashed model ids and bare names untouched', () => {
    expect(stripLegacyModelPrefix('meta-llama/llama-3.3-70b')).toBe('meta-llama/llama-3.3-70b')
    expect(stripLegacyModelPrefix('claude-sonnet-4-5')).toBe('claude-sonnet-4-5')
    expect(stripLegacyModelPrefix('/weird')).toBe('/weird')
  })
})
