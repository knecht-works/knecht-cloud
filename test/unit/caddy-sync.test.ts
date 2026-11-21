import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[][] = []
let caddyId = 'caddy123'
let running = 'old config'
let onDisk = 'new config'

vi.mock('execa', () => ({
  execa: vi.fn(async (_cmd: string, args: string[]) => {
    calls.push(args)
    if (args[0] === 'inspect' && args[2]?.includes('compose.project')) return { stdout: 'knecht\n' }
    if (args[0] === 'inspect' && args[2]?.includes('.Mounts')) return { stdout: 'caddy:2-alpine|/opt/knecht/Caddyfile\n' }
    if (args[0] === 'inspect') return { stdout: '' }
    if (args[0] === 'ps') return { stdout: caddyId }
    if (args[0] === 'exec') return { stdout: running }
    if (args[0] === 'run') return { stdout: onDisk }
    return { stdout: '' }
  }),
}))

async function freshSync() {
  vi.resetModules()
  return (await import('#server/daemon/caddy')).syncCaddyfile
}

describe('syncCaddyfile', () => {
  beforeEach(() => {
    calls.length = 0
    caddyId = 'caddy123'
    running = 'old config'
    onDisk = 'new config'
  })

  it('restarts caddy when it runs another Caddyfile than the one on disk', async () => {
    const syncCaddyfile = await freshSync()
    expect(await syncCaddyfile()).toBe(true)
    expect(calls).toContainEqual(['ps', '-q', '--filter', 'label=com.docker.compose.project=knecht', '--filter', 'label=com.docker.compose.service=caddy'])
    expect(calls).toContainEqual(expect.arrayContaining(['run', '-v', '/opt/knecht/Caddyfile:/Caddyfile:ro', 'caddy:2-alpine']))
    expect(calls).toContainEqual(['restart', 'caddy123'])
  })

  it('leaves caddy alone when its Caddyfile is current', async () => {
    const syncCaddyfile = await freshSync()
    running = onDisk
    expect(await syncCaddyfile()).toBe(false)
    expect(calls.some(c => c[0] === 'restart')).toBe(false)
  })

  it('does nothing without a caddy container, as in dev', async () => {
    const syncCaddyfile = await freshSync()
    caddyId = ''
    expect(await syncCaddyfile()).toBe(false)
    expect(calls.some(c => ['exec', 'run', 'restart'].includes(c[0]!))).toBe(false)
  })
})
