import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[][] = []
let volumeExists = false

vi.mock('execa', () => ({
  execa: vi.fn(async (_cmd: string, args: string[]) => {
    calls.push(args)
    if (args[0] === 'volume' && args[1] === 'inspect' && !volumeExists) throw new Error('no such volume')
    if (args[0] === 'version') return { stdout: JSON.stringify({ raw: { web: 'ddev/ddev-webserver:v1.25.6' } }) }
    return { stdout: '' }
  }),
}))

const { ensurePackageCache } = await import('#server/daemon/sandbox')

describe('ensurePackageCache', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('creates a missing volume and opens it to the containers\' uid', async () => {
    volumeExists = false
    await ensurePackageCache()
    expect(calls).toContainEqual(['volume', 'create', 'knecht-package-cache'])
    const chmod = calls.find(c => c.includes('chmod'))
    expect(chmod).toEqual(expect.arrayContaining(['--user', '0:0', 'knecht-package-cache:/cache', '1777', '/cache']))
  })

  it('leaves an existing volume alone', async () => {
    volumeExists = true
    await ensurePackageCache()
    expect(calls).toEqual([['volume', 'inspect', 'knecht-package-cache']])
  })
})
