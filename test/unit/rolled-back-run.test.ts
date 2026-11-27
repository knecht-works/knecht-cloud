import { describe, expect, it } from 'vitest'
import type { Step } from '#shared/utils/workflow'
import { runRolledBack } from '#shared/utils/run'
import { projectStatusMeta } from '~/utils/dashboard'

const bootOnly = [{ type: 'ddev-start', id: 'boot-preview' }] as Step[]
const workflow = [{ type: 'bash', id: 'work', command: 'true' }, { type: 'ddev-start', id: 'boot' }] as Step[]

describe('a cancelled run that only booted the preview', () => {
  it('counts as rolled back, a cancelled workflow with other steps does not', () => {
    expect(runRolledBack({ status: 'cancelled', steps: bootOnly })).toBe(true)
    expect(runRolledBack({ status: 'cancelled', steps: workflow })).toBe(false)
    expect(runRolledBack({ status: 'failed', steps: bootOnly })).toBe(false)
  })

  it('leaves the session showing its environment instead of Cancelled', () => {
    const run = { status: 'cancelled', envState: 'up', previewReady: false, sessionStatus: 'open' } as const
    expect(projectStatusMeta({ ...run, rolledBack: true }).label).not.toBe('Cancelled')
    expect(projectStatusMeta({ ...run, rolledBack: false }).label).toBe('Cancelled')
  })
})
