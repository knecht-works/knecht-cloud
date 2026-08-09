// The dashboard settings as GET /api/settings returns them: the tunable
// values plus read-only status fields the settings pages render. Shared by
// the settings subpages so each fetches the same shape.
export interface DashboardSettings {
  idleStopMinutes: number
  previewRetentionDays: number
  archiveRetentionDays: number
  maxConcurrentRuns: number
  aiProvider: string
  aiModel: string
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
