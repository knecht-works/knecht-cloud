export function useAiModels() {
  return useFetch<AiModel[]>('/api/ai-models', { key: 'ai-models', lazy: true, default: () => [] })
}
