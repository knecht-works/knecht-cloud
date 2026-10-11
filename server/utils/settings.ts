import { getSettingsRow, updateSettingsRow } from '../stores/settings'
import { decrypt } from './crypto'
import { defaultSshTarget } from './ssh'
import { settingsPreset } from './settings-preset'
import type { Settings } from '../db/schema'

export function getSettings(): Settings {
  return { ...getSettingsRow(), ...settingsPreset().overrides }
}

export type SettingsPatch = Partial<Omit<Settings, 'id'>>
export function updateSettings(patch: SettingsPatch): Settings {
  updateSettingsRow(patch)
  return getSettings()
}

// Every settings response goes through this: a new secret column gets its redaction here.
export function publicSettings(settings: Settings) {
  const { aiKeyEnc, ...rest } = settings
  return {
    ...rest,
    aiKeyConfigured: !!aiKeyEnc,
    aiKeyPreview: aiKeyEnc ? encKeyPreview(aiKeyEnc) : undefined,
    sshTargetDefault: defaultSshTarget(),
    presetKeys: settingsPreset().keys,
  }
}

// Star count capped so the preview does not leak the key length.
export function keyPreview(key: string): string {
  if (key.length <= 12) return '*'.repeat(key.length)
  return `${key.slice(0, 8)}${'*'.repeat(Math.min(key.length - 12, 16))}${key.slice(-4)}`
}

function encKeyPreview(enc: string): string | undefined {
  try {
    return keyPreview(decrypt(enc))
  }
  catch {
    return undefined
  }
}
