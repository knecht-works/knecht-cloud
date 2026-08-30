import { getTableColumns } from 'drizzle-orm'
import { settings } from '../db/schema'
import { encrypt } from './crypto'
import type { Settings } from '../db/schema'

// Settings preset: the installation can pin any settings column through an
// environment variable, e.g. for fleet instances provisioned by an operator.
// The env name is derived from the column's key (idleStopMinutes ->
// KNECHT_IDLE_STOP_MINUTES), and the value is parsed by the column's schema
// type, so a new settings column is presettable without touching anything
// here. Preset values override the DB row on every read (settings.ts) and
// their fields are rejected by PATCH and disabled in the UI (presetKeys).
//
// Exceptions that do not grow with the schema: `id` and `workflowsSeeded` are
// internal, and the AI key is preset as plaintext KNECHT_AI_KEY (the column
// stores ciphertext). It is encrypted ONCE and memoized: encrypt() uses a
// fresh nonce per call, and the model-catalog cache (ai-catalog.ts) scopes on
// the ciphertext, so a per-read encryption would bust that cache every read.
const NEVER_PRESET = new Set(['id', 'workflowsSeeded', 'aiKeyEnc'])

export function presetEnvName(columnKey: string): string {
  return `KNECHT_${columnKey.replace(/([A-Z])/g, '_$1').toUpperCase()}`
}

export interface SettingsPreset {
  overrides: Partial<Settings>
  /** Client-facing field names (aiKey, not aiKeyEnc), for PATCH guard + UI. */
  keys: string[]
}

// Pure worker, exported for tests; runtime callers use settingsPreset().
export function buildSettingsPreset(env: NodeJS.ProcessEnv): SettingsPreset {
  const overrides: Record<string, unknown> = {}
  const keys: string[] = []
  for (const [key, column] of Object.entries(getTableColumns(settings))) {
    if (NEVER_PRESET.has(key)) continue
    const name = presetEnvName(key)
    const raw = env[name]
    if (raw === undefined || raw === '') continue
    if (column.dataType === 'number') {
      const n = Number(raw)
      if (!Number.isInteger(n)) {
        console.error(`[settings] ignoring preset ${name}: '${raw}' is not an integer`)
        continue
      }
      overrides[key] = n
    }
    else if (column.dataType === 'boolean') {
      if (raw !== 'true' && raw !== 'false') {
        console.error(`[settings] ignoring preset ${name}: '${raw}' is not true/false`)
        continue
      }
      overrides[key] = raw === 'true'
    }
    else {
      overrides[key] = raw
    }
    keys.push(key)
  }
  if (env.KNECHT_AI_KEY) {
    overrides.aiKeyEnc = encrypt(env.KNECHT_AI_KEY)
    keys.push('aiKey')
  }
  return { overrides: overrides as Partial<Settings>, keys }
}

// Built once per process: env does not change at runtime, and the memoized
// aiKeyEnc ciphertext must stay stable (see above).
let cache: SettingsPreset | null = null
export function settingsPreset(): SettingsPreset {
  cache ??= buildSettingsPreset(process.env)
  return cache
}
