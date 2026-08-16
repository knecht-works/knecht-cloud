import { describe, expect, it } from 'vitest'
import {
  agentModelRef,
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
    const config = buildOpencodeConfig({ provider: 'anthropic', region: 'eu', model: 'claude-sonnet-4-5', subtaskModel: null })
    expect(config).toEqual({
      $schema: 'https://opencode.ai/config.json',
      // Exactly three entries: opencode adds a prompt-cache breakpoint per
      // file and Anthropic caps cache_control blocks at 4 per request.
      instructions: [RULES_PATH, WORKFLOW_SYSTEM_PATH, MEMORY_INDEX_PATH],
    })
  })

  it('declares langdock as a custom provider with the region endpoint and env key', () => {
    const config = buildOpencodeConfig({ provider: 'langdock', region: 'eu', model: 'gpt-5.1', subtaskModel: null })
    expect(config.provider!.langdock).toEqual({
      npm: '@ai-sdk/openai',
      name: 'Langdock',
      options: {
        baseURL: 'https://api.langdock.com/openai/eu/v1',
        apiKey: '{env:LANGDOCK_API_KEY}',
        setCacheKey: false,
      },
      models: { 'gpt-5.1': {} },
    })
    expect(config.provider!['langdock-anthropic']).toBeUndefined()
  })

  it('routes a langdock Claude model to the Anthropic-compatible endpoint', () => {
    const config = buildOpencodeConfig({ provider: 'langdock', region: 'eu', model: 'claude-sonnet-4-5', subtaskModel: null })
    expect(config.provider!['langdock-anthropic']).toEqual({
      npm: '@ai-sdk/anthropic',
      name: 'Langdock (Anthropic)',
      options: {
        baseURL: 'https://api.langdock.com/anthropic/eu/v1',
        apiKey: '{env:LANGDOCK_API_KEY}',
      },
      models: { 'claude-sonnet-4-5': {} },
    })
    expect(config.provider!.langdock).toBeUndefined()
  })

  it('splits mixed langdock models across both route blocks', () => {
    const config = buildOpencodeConfig({ provider: 'langdock', region: 'eu', model: 'gpt-5.1', subtaskModel: 'claude-haiku-4-5' })
    expect(config.provider!.langdock.models).toEqual({ 'gpt-5.1': {} })
    expect(config.provider!['langdock-anthropic']!.models).toEqual({ 'claude-haiku-4-5': {} })
    expect(config.small_model).toBe('langdock-anthropic/claude-haiku-4-5')
  })

  it('switches the endpoints with the region', () => {
    const config = buildOpencodeConfig({ provider: 'langdock', region: 'us', model: 'gpt-4o', subtaskModel: 'claude-haiku-4-5' })
    expect(config.provider!.langdock.options.baseURL).toBe('https://api.langdock.com/openai/us/v1')
    expect(config.provider!['langdock-anthropic']!.options.baseURL).toBe('https://api.langdock.com/anthropic/us/v1')
  })

  it('registers a legacy-prefixed model under its bare name', () => {
    const config = buildOpencodeConfig({ provider: 'langdock', region: 'eu', model: 'anthropic/claude-sonnet-4-5', subtaskModel: null })
    expect(config.provider!['langdock-anthropic']!.models).toEqual({ 'claude-sonnet-4-5': {} })
  })

  it('emits small_model prefixed with its route block and registers it at langdock', () => {
    const config = buildOpencodeConfig({ provider: 'langdock', region: 'eu', model: 'claude-sonnet-4-5', subtaskModel: 'claude-haiku-4-5' })
    expect(config.small_model).toBe('langdock-anthropic/claude-haiku-4-5')
    expect(config.provider!['langdock-anthropic']!.models).toEqual({ 'claude-sonnet-4-5': {}, 'claude-haiku-4-5': {} })
  })

  it('emits small_model for registry providers and strips a legacy prefix from it', () => {
    const config = buildOpencodeConfig({ provider: 'anthropic', region: 'eu', model: 'claude-sonnet-4-5', subtaskModel: 'anthropic/claude-haiku-4-5' })
    expect(config.small_model).toBe('anthropic/claude-haiku-4-5')
    expect(config.provider).toBeUndefined()
  })

  it('dedupes the langdock models map when main and subtask model match', () => {
    const config = buildOpencodeConfig({ provider: 'langdock', region: 'eu', model: 'gpt-4o', subtaskModel: 'gpt-4o' })
    expect(config.provider!.langdock.models).toEqual({ 'gpt-4o': {} })
  })
})

describe('agentModelRef', () => {
  it('routes langdock models to their route block, everything else to the provider id', () => {
    expect(agentModelRef('langdock', 'claude-sonnet-4-5')).toBe('langdock-anthropic/claude-sonnet-4-5')
    expect(agentModelRef('langdock', 'gpt-5.1')).toBe('langdock/gpt-5.1')
    expect(agentModelRef('anthropic', 'claude-sonnet-4-5')).toBe('anthropic/claude-sonnet-4-5')
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
