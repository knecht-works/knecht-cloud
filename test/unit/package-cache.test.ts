import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[][] = []
let failChmod = false

vi.mock('execa', () => ({
  execa: vi.fn(async (_cmd: string, args: string[]) => {
    calls.push(args)
    if (args.includes('chmod') && failChmod) throw new Error('pull failed')
    if (args[0] === 'version') return { stdout: JSON.stringify({ raw: { web: 'ddev/ddev-webserver:v1.25.6' } }) }
    return { stdout: '' }
  }),
}))

async function freshEnsure() {
  vi.resetModules()
  return (await import('#server/daemon/sandbox')).ensurePackageCache
}

describe('ensurePackageCache', () => {
  beforeEach(() => {
    calls.length = 0
    failChmod = false
  })

  it('creates the volume and opens it to the containers\' uid once per process', async () => {
    const ensurePackageCache = await freshEnsure()
    await Promise.all([ensurePackageCache(), ensurePackageCache()])
    await ensurePackageCache()
    expect(calls.filter(c => c[0] === 'volume')).toEqual([['volume', 'create', 'knecht-package-cache']])
    const chmods = calls.filter(c => c.includes('chmod'))
    expect(chmods).toHaveLength(1)
    expect(chmods[0]).toEqual(expect.arrayContaining(['--user', '0:0', 'knecht-package-cache:/cache', '1777', '/cache']))
  })

  it('opens an existing root-owned volume after a failed chmod', async () => {
    const ensurePackageCache = await freshEnsure()
    failChmod = true
    await expect(ensurePackageCache()).rejects.toThrow('pull failed')
    failChmod = false
    calls.length = 0
    await ensurePackageCache()
    expect(calls.filter(c => c.includes('chmod'))).toHaveLength(1)
  })
})
