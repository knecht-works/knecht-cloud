import { useFetch } from '#imports'
import type { AiModel } from '#shared/utils/ai'

export function useAiModels() {
  return useFetch<AiModel[]>('/api/ai-models', { key: 'ai-models', lazy: true, default: () => [] })
}
