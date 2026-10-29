import { describe, expect, it } from 'vitest'
import { runHasEnv } from '../../shared/utils/run'
import type { Step } from '../../shared/utils/workflow'

const boot = [{ type: 'ddev-start' }] as Step[]
const noBoot = [{ type: 'create-pr' }] as Step[]

describe('runHasEnv', () => {
  it('a run without a boot step shows the env its session already has', () => {
    expect(runHasEnv('preview', noBoot)).toBe(true)
    expect(runHasEnv('preview', null)).toBe(true)
  })

  it('with nothing booted only the run that boots counts', () => {
    expect(runHasEnv('code', boot)).toBe(true)
    expect(runHasEnv('code', noBoot)).toBe(false)
    expect(runHasEnv('code', null)).toBe(false)
  })
})
