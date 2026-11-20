import { getSettingsRow, updateSettingsRow } from '#server/stores/settings'
import { keyPreview } from '#shared/utils/key-preview'
import { decrypt } from '#server/utils/crypto'
import { defaultSshTarget } from '#server/utils/ssh'
import { settingsPreset } from '#server/utils/settings-preset'
import type { Settings } from '#server/db/schema'

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

export function encKeyPreview(enc: string): string | undefined {
  try {
    return keyPreview(decrypt(enc))
  }
  catch {
    return undefined
  }
}
