import type { LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { type AiProviderId, type LangdockRegion, langdockAnthropicBaseUrl, langdockBaseUrl, stripLegacyModelPrefix } from '../../shared/utils/ai'
import { registryRoute } from './ai-catalog'
import { decrypt } from './crypto'
import { langdockProviderKey } from './opencode-config'
import { getSettings } from './settings'

export type ModelRole = 'default' | 'fast'

export async function languageModel(role: ModelRole): Promise<LanguageModel> {
  const settings = getSettings()
  if (!settings.aiKeyEnc) {
    throw new Error('AI provider API key not configured, add it under Settings → Agent')
  }
  const configured = role === 'fast' ? settings.aiSubtaskModel ?? settings.aiModel : settings.aiModel
  if (!configured) {
    throw new Error('No default model configured (a provider switch clears it), pick one under Settings → Agent')
  }
  const provider = settings.aiProvider as AiProviderId
  const model = stripLegacyModelPrefix(configured)
  const route = provider === 'opencode' || provider === 'opencode-go' ? await registryRoute(provider, model) : {}
  return createLanguageModel({ provider, region: settings.aiRegion, model, apiKey: decrypt(settings.aiKeyEnc), ...route })
}

export interface LanguageModelInput {
  provider: AiProviderId
  region: LangdockRegion
  model: string
  apiKey: string
  npm?: string
  api?: string
}

export function createLanguageModel({ provider, region, model, apiKey, npm, api }: LanguageModelInput): LanguageModel {
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(model)
    case 'openai':
      return createOpenAI({ apiKey })(model)
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model)
    case 'langdock':
      return langdockProviderKey(model) === 'langdock-anthropic'
        ? createAnthropic({ apiKey, baseURL: langdockAnthropicBaseUrl(region) })(model)
        : createOpenAI({ apiKey, baseURL: langdockBaseUrl(region) })(model)
    case 'opencode':
    case 'opencode-go':
      if (!api) throw new Error(`models.dev has no endpoint for ${provider}/${model}`)
      switch (npm) {
        case '@ai-sdk/anthropic':
          return createAnthropic({ apiKey, baseURL: api })(model)
        case '@ai-sdk/openai':
          return createOpenAI({ apiKey, baseURL: api })(model)
        case '@ai-sdk/google':
          return createGoogleGenerativeAI({ apiKey, baseURL: api })(model)
        case '@ai-sdk/openai-compatible':
        case undefined:
          return createOpenAICompatible({ name: provider, apiKey, baseURL: api })(model)
        default:
          throw new Error(`${provider}/${model} needs ${npm}, which Knecht does not support yet`)
      }
  }
}
