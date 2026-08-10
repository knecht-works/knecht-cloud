import { describe, expect, it } from 'vitest'
import {
  buildAgentRules,
  buildOpencodeConfig,
  MEMORY_INDEX_PATH,
  RULES_PATH,
  WORKFLOW_SYSTEM_PATH,
} from '../../server/utils/opencode-config'

// The generated opencode.json, asserted structurally: the instructions the
// agent always receives, and the custom provider block a gateway provider
// (langdock) needs because it is not in models.dev.

describe('buildOpencodeConfig', () => {
  it('emits the static instructions array and no provider block for registry providers', () => {
    const config = buildOpencodeConfig({ provider: 'anthropic', region: 'eu', model: 'claude-sonnet-4-5' })
    expect(config).toEqual({
      $schema: 'https://opencode.ai/config.json',
      // Exactly three entries: opencode adds a prompt-cache breakpoint per
      // file and Anthropic caps cache_control blocks at 4 per request.
      instructions: [RULES_PATH, WORKFLOW_SYSTEM_PATH, MEMORY_INDEX_PATH],
    })
  })

  it('declares langdock as a custom provider with the region endpoint and env key', () => {
    const config = buildOpencodeConfig({ provider: 'langdock', region: 'eu', model: 'claude-sonnet-4-5' })
    expect(config.provider!.langdock).toEqual({
      npm: '@ai-sdk/openai-compatible',
      name: 'Langdock',
      options: {
        baseURL: 'https://api.langdock.com/openai/eu/v1',
        apiKey: '{env:LANGDOCK_API_KEY}',
      },
      models: { 'claude-sonnet-4-5': {} },
    })
  })

  it('switches the endpoint with the region', () => {
    const config = buildOpencodeConfig({ provider: 'langdock', region: 'us', model: 'gpt-4o' })
    expect(config.provider!.langdock.options.baseURL).toBe('https://api.langdock.com/openai/us/v1')
  })

  it('registers a legacy-prefixed model under its bare name', () => {
    const config = buildOpencodeConfig({ provider: 'langdock', region: 'eu', model: 'anthropic/claude-sonnet-4-5' })
    expect(config.provider!.langdock.models).toEqual({ 'claude-sonnet-4-5': {} })
  })
})

describe('buildAgentRules', () => {
  it('renders both layers with the project section last', () => {
    const rules = buildAgentRules('Instance rule.', 'Project rule.')
    expect(rules).toBe(
      '# Instance rules\n\nInstance rule.\n\n'
      + '# Project rules\n\nOn conflict these override the instance rules.\n\nProject rule.\n',
    )
  })

  it('omits empty layers entirely', () => {
    expect(buildAgentRules('Only instance.', '  ')).toBe('# Instance rules\n\nOnly instance.\n')
    expect(buildAgentRules('', 'Only project.')).toContain('# Project rules')
    expect(buildAgentRules('', '')).toBe('')
  })
})
