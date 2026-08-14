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
  /** Langdock region (eu/us); present for every provider, used by langdock. */
  aiRegion: string
  /** Default agent model; null after a provider switch until a new one is picked. */
  aiModel: string | null
  /** Optional faster model for the agent's internal small tasks; null = main model. */
  aiSubtaskModel?: string | null
  /** Instance-level agent instructions, layered into every agent run. */
  agentInstructions: string
  /** Whether a provider API key is stored (the key itself never leaves the server). */
  aiKeyConfigured?: boolean
  /** Masked recognition preview of the stored key (first 8 + last 4 visible). */
  aiKeyPreview?: string
  sshTarget?: string | null
  /** What an empty sshTarget falls back to (root@<base domain> on servers). */
  sshTargetDefault?: string | null
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
