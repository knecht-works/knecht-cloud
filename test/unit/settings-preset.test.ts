import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildSettingsPreset, presetEnvName } from '../../server/utils/settings-preset'
import { decrypt } from '../../server/utils/crypto'

// The preset env names are derived from the settings columns; encrypt/decrypt
// (the KNECHT_AI_KEY special case) needs the session password.
beforeAll(() => {
  process.env.NUXT_SESSION_PASSWORD = 'test-password-that-is-long-enough-0123'
})

describe('presetEnvName', () => {
  it('derives KNECHT_SNAKE_CASE from the column key', () => {
    expect(presetEnvName('idleStopMinutes')).toBe('KNECHT_IDLE_STOP_MINUTES')
    expect(presetEnvName('autoUpdateCron')).toBe('KNECHT_AUTO_UPDATE_CRON')
    expect(presetEnvName('aiProvider')).toBe('KNECHT_AI_PROVIDER')
    expect(presetEnvName('sshTarget')).toBe('KNECHT_SSH_TARGET')
  })
})

describe('buildSettingsPreset', () => {
  it('is empty without preset vars', () => {
    const p = buildSettingsPreset({})
    expect(p.overrides).toEqual({})
    expect(p.keys).toEqual([])
  })

  it('parses values by the column type', () => {
    const p = buildSettingsPreset({
      KNECHT_MAX_CONCURRENT_RUNS: '3',
      KNECHT_AUTO_UPDATE_CRON: '0 3 * * *',
      KNECHT_AI_PROVIDER: 'anthropic',
    })
    expect(p.overrides).toEqual({ maxConcurrentRuns: 3, autoUpdateCron: '0 3 * * *', aiProvider: 'anthropic' })
    expect(p.keys.sort()).toEqual(['aiProvider', 'autoUpdateCron', 'maxConcurrentRuns'])
  })

  it('ignores unparsable and empty values instead of failing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = buildSettingsPreset({
      KNECHT_MAX_CONCURRENT_RUNS: 'many',
      KNECHT_SSH_TARGET: '',
    })
    expect(p.overrides).toEqual({})
    expect(p.keys).toEqual([])
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it('never presets internal columns', () => {
    const p = buildSettingsPreset({ KNECHT_ID: '2', KNECHT_WORKFLOWS_SEEDED: 'true' })
    expect(p.overrides).toEqual({})
    expect(p.keys).toEqual([])
  })

  it('encrypts KNECHT_AI_KEY and reports it under the client name aiKey', () => {
    const p = buildSettingsPreset({ KNECHT_AI_KEY: 'sk-test-123' })
    expect(p.keys).toEqual(['aiKey'])
    expect(decrypt(p.overrides.aiKeyEnc!)).toBe('sk-test-123')
  })
})
