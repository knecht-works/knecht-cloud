// The `ai` step's model catalog, shared (one keyed fetch) between the settings
// page and every model picker in the builder.
export function useAiModels() {
  return useFetch<AiModel[]>('/api/ai-models', { key: 'ai-models', lazy: true, default: () => [] })
}
