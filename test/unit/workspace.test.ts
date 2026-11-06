import { mkdirSync, mkdtempSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KNECHT_CONFIG_FILE, writeDdevConfig } from '../../server/daemon/ddev'
import { readWebEnvironment } from '../../server/daemon/workspace'
import { resolveEnv } from '../../shared/utils/env-spec'
import type { EnvVar } from '../../shared/utils/env'

async function configured(envVars: EnvVar[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'knecht-workspace-'))
  mkdirSync(join(dir, '.ddev'))
  writeFileSync(join(dir, '.ddev', 'config.yaml'), 'name: demo\ntype: craftcms\ncomposer_root: app\n')
  await writeDdevConfig(dir, {
    sessionId: 7,
    env: resolveEnv({
      source: 'ddev',
      fields: {
        hosts: { value: ['demo.ddev.site'], source: '.ddev/config.yaml' },
        hasDb: { value: true, source: '.ddev/config.yaml' },
      },
      warnings: [],
    }, { phpVersion: null, nodeVersion: null, packageManager: null, database: null, devServer: null, previewPort: null }),
    urlMode: 'rewrite',
    envVars,
  })
  return dir
}

describe('readWebEnvironment', () => {
  it('gives the workspace the web service env, without the preview addresses', async () => {
    const dir = await configured([{ key: 'PASSWORD', value: 'a$b' }])

    const environment = readWebEnvironment(dir)

    expect(environment).toContain('PASSWORD=a$b')
    expect(environment).toContain('XDEBUG_MODE=off')
    expect(environment).toContain('DDEV_PROJECT=knecht-run-7')
    expect(environment).toContain('DDEV_COMPOSER_ROOT=/var/www/html/app')
    expect(environment).toContain('IS_DDEV_PROJECT=true')
    expect(environment.filter(e => e.startsWith('KNECHT_'))).toEqual([])
  })

  it('keeps a preview variable the project sets itself', async () => {
    const dir = await configured([{ key: 'KNECHT_PREVIEW_URL', value: 'https://staging.example.com' }])
    expect(readWebEnvironment(dir, new Set(['KNECHT_PREVIEW_URL']))).toContain('KNECHT_PREVIEW_URL=https://staging.example.com')
  })

  it('refuses a checkout Knecht has not configured yet', () => {
    expect(() => readWebEnvironment(mkdtempSync(join(tmpdir(), 'knecht-workspace-')))).toThrow(/no Knecht environment config/)
  })

  it('refuses a Knecht config that links to another session\'s', async () => {
    const other = await configured([{ key: 'SECRET', value: 'other project' }])
    const dir = await configured([])
    const own = join(dir, '.ddev', KNECHT_CONFIG_FILE)
    renameSync(own, `${own}.bak`)
    symlinkSync(join(other, '.ddev', KNECHT_CONFIG_FILE), own)
    expect(() => readWebEnvironment(dir)).toThrow(/not a regular file/)
  })

  it('refuses a .ddev dir that links elsewhere', async () => {
    const other = await configured([])
    const dir = mkdtempSync(join(tmpdir(), 'knecht-workspace-'))
    symlinkSync(join(other, '.ddev'), join(dir, '.ddev'))
    expect(() => readWebEnvironment(dir)).toThrow(/not a directory/)
  })
})
