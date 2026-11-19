import { describe, expect, it, vi } from 'vitest'

const inspect = vi.hoisted(() => ({ stdout: '' }))
vi.mock('execa', () => ({ execa: async () => ({ stdout: inspect.stdout }) }))

const { resolveContainerIp } = await import('#server/daemon/sandbox')

describe('resolveContainerIp', () => {
  it('answers no address while the container is not running, and does not cache it', async () => {
    inspect.stdout = 'invalid IP\n'
    expect(await resolveContainerIp(1, 'web')).toBeNull()
    inspect.stdout = '172.18.0.3\n'
    expect(await resolveContainerIp(1, 'web')).toBe('172.18.0.3')
  })
})
