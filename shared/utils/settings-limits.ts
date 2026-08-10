// Bounds for the tunable settings, shared between the PATCH /api/settings
// schema and the settings pages' inline validation so the two can't drift.
export const SETTINGS_LIMITS = {
  idleStopMinutes: { min: 1, max: 10080 },
  previewRetentionDays: { min: 0, max: 365 },
  archiveRetentionDays: { min: 0, max: 3650 },
  maxConcurrentRuns: { min: 1, max: 20 },
} as const

// The charset excludes whitespace/quotes so the value can be spliced
// verbatim into the ssh command line (utils/ssh.ts sshTerminalCommand).
export const SSH_TARGET_RE = /^[A-Za-z0-9._@-]+$/

// Cap for the instance and project agent instructions (docs/adr/0002): they
// ride in the agent's context on every invocation, so they stay small.
// Enforced by both PATCH endpoints and shown by the textareas.
export const AGENT_INSTRUCTIONS_MAX = 8000
