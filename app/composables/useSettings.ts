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
  /** 5-field cron schedule for automatic updates; '' = off. */
  autoUpdateCron: string
  /** Fields pinned by the installation's env preset; their controls are disabled. */
  presetKeys: string[]
}

export function useSettings() {
  return useFetch<DashboardSettings>('/api/settings', { key: 'settings', lazy: true })
}

// Whether a field is pinned by the installation's env preset (KNECHT_* vars,
// server/utils/settings-preset.ts). Pages disable those controls.
export function isPreset(settings: DashboardSettings | undefined | null, key: string): boolean {
  return settings?.presetKeys.includes(key) ?? false
}

// PATCH a slice of the settings and merge the server echo into the loaded row
// IN PLACE: reassigning the ref would re-fire the pages' settings watchers
// and reset fields the user is still editing to the echo.
// Preset fields are stripped from the body first: the pages' autosaves send
// whole field groups, and the server rejects any preset field in a patch.
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
