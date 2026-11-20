import { createError } from 'h3'
import { type AiProviderId, type LangdockRegion, aiProviderSpec, langdockBaseUrl } from '#shared/utils/ai'

function keyProbe(provider: AiProviderId, region: LangdockRegion, key: string): { url: string, headers: Record<string, string> } {
  const bearer = { Authorization: `Bearer ${key}` }
  switch (provider) {
    case 'opencode':
    case 'opencode-go':
      return { url: aiProviderSpec(provider)!.modelsUrl!, headers: bearer }
    case 'anthropic':
      return { url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', headers: bearer }
    case 'google':
      return { url: 'https://generativelanguage.googleapis.com/v1beta/models', headers: { 'x-goog-api-key': key } }
    case 'langdock':
      return { url: `${langdockBaseUrl(region)}/models`, headers: bearer }
  }
}

// Only a clear refusal blocks the save: an outage or timeout must not keep a working key out.
export async function assertAiKeyAccepted(provider: AiProviderId, region: LangdockRegion, key: string): Promise<void> {
  const { url, headers } = keyProbe(provider, region, key)
  let status: number
  try {
    status = (await fetch(url, { headers, signal: AbortSignal.timeout(10_000) })).status
  }
  catch {
    return
  }
  // Google answers an unknown key with 400 instead of 401.
  if (status === 401 || status === 403 || (provider === 'google' && status === 400)) {
    throw createError({ statusCode: 400, statusMessage: `Key rejected by ${aiProviderSpec(provider)!.label}.` })
  }
}
