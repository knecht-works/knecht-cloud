import { useFetch } from '#imports'
import type { AiModel } from '#shared/utils/ai'

export function useAiModels() {
  return useFetch<AiModel[]>('/api/ai-models', { key: 'ai-models', lazy: true, default: () => [] })
}

export function useProjectAiModels(projectId: number) {
  return useFetch<AiModel[]>(`/api/projects/${projectId}/ai-models`, { key: `project-ai-models:${projectId}`, lazy: true, default: () => [] })
}
