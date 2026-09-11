export const SETTINGS_LIMITS = {
  idleStopMinutes: { min: 1, max: 10080 },
  previewRetentionDays: { min: 0, max: 365 },
  archiveRetentionDays: { min: 0, max: 3650 },
  maxConcurrentRuns: { min: 1, max: 20 },
} as const

// Charset excludes whitespace and quotes: the value is spliced verbatim into the ssh command line.
export const SSH_TARGET_RE = /^[A-Za-z0-9._@-]+$/

export const AGENT_INSTRUCTIONS_MAX = 8000
