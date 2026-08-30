import type { Ref } from 'vue'

// The dashboard settings as GET /api/settings returns them: the tunable
// values plus read-only status fields the settings pages render. Shared by
// the settings subpages so each fetches the same shape.
export interface DashboardSettings {
  idleStopMinutes: number
  previewRetentionDays: number
  archiveRetentionDays: number
  maxConcurrentRuns: number
  aiProvider: string
  aiRegion: string
  aiModel: string | null
  aiSubtaskModel?: string | null
  agentInstructions: string
  aiKeyConfigured?: boolean
  aiKeyPreview?: string
  sshTarget?: string | null
  sshTargetDefault?: string | null
  autoUpdate: boolean
}

export function useSettings() {
  return useFetch<DashboardSettings>('/api/settings', { key: 'settings', lazy: true })
}

// PATCH a slice of the settings and merge the server echo into the loaded row
// IN PLACE: reassigning the ref would re-fire the pages' settings watchers
// and reset fields the user is still editing to the echo.
export async function patchSettings(
  settings: Ref<DashboardSettings | undefined | null>,
  body: Record<string, unknown>,
): Promise<void> {
  const updated = await $fetch<DashboardSettings>('/api/settings', { method: 'PATCH', body })
  if (settings.value) Object.assign(settings.value, updated)
  else settings.value = updated
}
