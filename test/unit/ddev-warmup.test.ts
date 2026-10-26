import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[][] = []
let failStart = false

vi.mock('execa', () => ({
  execa: vi.fn(async (_cmd: string, args: string[]) => {
    calls.push(args)
    if (args[0] === '--version') return { stdout: 'ddev version v1.25.5' }
    if (args[0] === 'start' && failStart) throw new Error('pull failed')
    return { stdout: '' }
  }),
}))

const { warmUpDdev } = await import('../../server/daemon/sandbox')

describe('warmUpDdev', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'knecht-warmup-'))
    process.env.KNECHT_DATA_DIR = dataDir
    calls.length = 0
    failStart = false
  })

  it('boots and deletes a throwaway project once per ddev version', async () => {
    await warmUpDdev()
    expect(calls.map(a => a[0])).toEqual(['--version', 'config', 'start', 'delete'])
    expect(readFileSync(join(dataDir, 'ddev-warmed'), 'utf8')).toBe('ddev version v1.25.5')
    expect(existsSync(join(dataDir, 'ddev-warmup'))).toBe(false)

    calls.length = 0
    await warmUpDdev()
    expect(calls.map(a => a[0])).toEqual(['--version'])
  })

  it('warms up again after a ddev upgrade', async () => {
    writeFileSync(join(dataDir, 'ddev-warmed'), 'ddev version v1.25.2')
    await warmUpDdev()
    expect(calls.map(a => a[0])).toContain('start')
  })

  it('cleans up and retries on the next boot when the warm-up fails', async () => {
    failStart = true
    await expect(warmUpDdev()).resolves.toBeUndefined()
    expect(calls.map(a => a[0])).toEqual(['--version', 'config', 'start', 'delete'])
    expect(existsSync(join(dataDir, 'ddev-warmed'))).toBe(false)
    expect(existsSync(join(dataDir, 'ddev-warmup'))).toBe(false)
  })
})
