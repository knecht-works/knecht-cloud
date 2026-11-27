import { describe, expect, it } from 'vitest'
import { envActions, type EnvActionInput } from '#shared/utils/run'

const idle: EnvActionInput = { envState: 'up', operation: null, working: false, hasEnv: true, previewReady: true, previewLost: false }

describe('envActions', () => {
  it.each([
    [{ envState: 'up' }, ['terminal', 'ide', 'stop']],
    [{ envState: 'up', working: true }, ['terminal']],
    [{ envState: 'stopped' }, ['archive', 'reboot']],
    [{ envState: 'stopped', working: true }, ['archive']],
    // The boot of a stopped code session did not finish: the run retries it.
    [{ envState: 'stopped', previewReady: false }, ['archive']],
    [{ envState: 'stopped', previewReady: false, previewLost: true }, ['archive', 'reboot']],
    [{ envState: 'archived' }, ['restore']],
    [{ envState: 'archived', working: true }, []],
    [{ envState: 'down' }, []],
    [{ envState: 'up', hasEnv: false, previewReady: false }, ['terminal', 'ide', 'stop', 'startPreview']],
    [{ envState: 'up', hasEnv: false, previewReady: false, working: true }, ['terminal']],
    [{ envState: 'up', hasEnv: false, previewReady: false, previewLost: true }, ['terminal', 'ide', 'stop', 'bootPreview']],
    [{ envState: 'up', hasEnv: false, previewReady: false, previewLost: true, working: true }, ['terminal']],
  ] as const)('%o offers %o', (input, expected) => {
    expect(envActions({ ...idle, ...input })).toEqual(expected)
  })

  it.each(['stopping', 'archiving', 'expiring'] as const)('offers nothing while %s', (operation) => {
    for (const envState of ['down', 'up', 'stopped', 'archived'] as const) {
      expect(envActions({ ...idle, envState, operation, hasEnv: false })).toEqual([])
    }
  })

  it.each(['booting', 'rebooting', 'restoring'] as const)('offers only its cancel while %s, and leaves a run\'s own to the run', (operation) => {
    expect(envActions({ ...idle, operation })).toEqual(['cancel'])
    expect(envActions({ ...idle, operation, working: true })).toEqual([])
  })
})
