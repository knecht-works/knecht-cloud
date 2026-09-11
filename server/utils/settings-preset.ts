import { getTableColumns } from 'drizzle-orm'
import { settings } from '../db/schema'
import { encrypt } from './crypto'
import type { Settings } from '../db/schema'

// The AI key is encrypted once and memoized: encrypt() uses a fresh nonce per
// call and the model-catalog cache keys on the ciphertext.
const NEVER_PRESET = new Set(['id', 'workflowsSeeded', 'aiKeyEnc'])

export function presetEnvName(columnKey: string): string {
  return `KNECHT_${columnKey.replace(/([A-Z])/g, '_$1').toUpperCase()}`
}

export interface SettingsPreset {
  overrides: Partial<Settings>
  keys: string[]
}

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

let cache: SettingsPreset | null = null
export function settingsPreset(): SettingsPreset {
  cache ??= buildSettingsPreset(process.env)
  return cache
}
