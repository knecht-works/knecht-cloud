import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { KNECHT_COMPOSE_FILE, writeDdevConfig } from '#server/daemon/ddev'
import { sessionCheckoutDir } from '#server/utils/storage'
import { resolveEnv } from '#shared/utils/env-spec'

const SESSION = 1001
const dockerRuns = vi.hoisted(() => [] as string[][])
const dockerCps = vi.hoisted(() => [] as string[][])
vi.mock('execa', () => ({
  execa: async (cmd: string, args: string[]) => {
    if (cmd === 'docker' && args[0] === 'run') dockerRuns.push(args)
    if (cmd === 'docker' && args[0] === 'cp') dockerCps.push(args)
    if (cmd === 'docker' && args[0] === 'inspect') throw new Error('no such container')
    return { stdout: '', stderr: '', exitCode: 0 }
  },
}))
vi.mock('#server/stores/sessions', () => ({ getSessionRow: () => ({ id: SESSION, projectId: 3 }) }))
vi.mock('#server/stores/projects', () => ({ getProject: () => ({ id: 3, envVars: [], sharedFolders: [] }) }))
vi.mock('#server/utils/agent-bridge', () => ({ writeBridgeCredentialHelper: async () => {} }))
vi.mock('#server/daemon/sandbox', () => ({
  WEB_PROJECT_DIR: '/var/www/html',
  attachKnecht: async () => {},
  ddevWebImage: async () => 'ddev/ddev-webserver:v1',
  ensurePackageCache: async () => {},
  forgetPreview: () => {},
  knechtContainer: async () => null,
}))

const { ensureWorkspaceUp } = await import('#server/daemon/workspace')

describe('startWorkspace', () => {
  it('takes mounts and limits from Knecht, not from the compose file in the checkout', async () => {
    const home = mkdtempSync(join(tmpdir(), 'knecht-home-'))
    mkdirSync(join(home, '.ddev', 'commands', 'web'), { recursive: true })
    vi.stubEnv('HOME', home)
    const dir = sessionCheckoutDir(SESSION)
    mkdirSync(join(dir, '.ddev'), { recursive: true })
    writeFileSync(join(dir, '.ddev', 'config.yaml'), 'name: demo\ntype: php\n')
    await writeDdevConfig(dir, {
      sessionId: SESSION,
      env: resolveEnv({ source: 'ddev', fields: { hasDb: { value: false, source: '.ddev/config.yaml' } }, warnings: [] }, { phpVersion: null, nodeVersion: null, packageManager: null, database: null, devServer: null, previewPort: null }),
      urlMode: 'rewrite',
      envVars: [],
    })
    writeFileSync(join(dir, '.ddev', KNECHT_COMPOSE_FILE), 'services:\n  web:\n    volumes:\n      - /data/knecht/data:/mnt/a:rw\n')

    await ensureWorkspaceUp(SESSION)

    expect(dockerRuns).toHaveLength(1)
    const argv = dockerRuns[0]!.join(' ')
    expect(argv).not.toContain('/data/knecht/data')
    expect(argv).toContain('--memory 2g')
    expect(argv).toContain('--pids-limit 2048')
    expect(argv).toContain('-v knecht-package-cache:/mnt/knecht-package-cache')
    expect(argv).toContain('--no-healthcheck')
    expect(dockerCps).toEqual([['cp', join(home, '.ddev', 'commands'), 'knecht-run-1001-workspace:/usr/local/lib/ddev/global-commands']])
    vi.unstubAllEnvs()
  })
})
