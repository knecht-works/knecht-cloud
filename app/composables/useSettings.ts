import type { Ref } from 'vue'

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
  /** 5-field cron; '' = off. */
  autoUpdateCron: string
  presetKeys: string[]
}

export function useSettings() {
  return useFetch<DashboardSettings>('/api/settings', { key: 'settings', lazy: true })
}

export function isPreset(settings: DashboardSettings | undefined | null, key: string): boolean {
  return settings?.presetKeys.includes(key) ?? false
}

// Merged in place: reassigning the ref re-fires the pages' settings watchers and
// resets fields still being edited. Preset fields are stripped, the server rejects them.
export async function patchSettings(
  settings: Ref<DashboardSettings | undefined | null>,
  body: Record<string, unknown>,
): Promise<void> {
  const filtered = Object.fromEntries(Object.entries(body).filter(([k]) => !isPreset(settings.value, k)))
  if (!Object.keys(filtered).length) return
  const updated = await $fetch<DashboardSettings>('/api/settings', { method: 'PATCH', body: filtered })
  if (settings.value) Object.assign(settings.value, updated)
  else settings.value = updated
}
