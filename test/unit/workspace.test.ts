import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeDdevConfig } from '../../server/daemon/ddev'
import { readWebOverrides } from '../../server/daemon/workspace'
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

describe('readWebOverrides', () => {
  it('gives the workspace the web service env and mounts, without the preview addresses', async () => {
    const dir = await configured([{ key: 'PASSWORD', value: 'a$b' }])

    const web = readWebOverrides(dir)

    expect(web.environment).toContain('PASSWORD=a$b')
    expect(web.environment).toContain('XDEBUG_MODE=off')
    expect(web.environment).toContain('DDEV_PROJECT=knecht-run-7')
    expect(web.environment).toContain('DDEV_COMPOSER_ROOT=/var/www/html/app')
    expect(web.environment).toContain('IS_DDEV_PROJECT=true')
    expect(web.environment.filter(e => e.startsWith('KNECHT_'))).toEqual([])
    expect(web.memLimit).toBe('2g')
    expect(web.pidsLimit).toBe(2048)
  })

  it('keeps a preview variable the project sets itself', async () => {
    const dir = await configured([{ key: 'KNECHT_PREVIEW_URL', value: 'https://staging.example.com' }])
    expect(readWebOverrides(dir, new Set(['KNECHT_PREVIEW_URL'])).environment).toContain('KNECHT_PREVIEW_URL=https://staging.example.com')
  })

  it('refuses a checkout Knecht has not configured yet', () => {
    expect(() => readWebOverrides(mkdtempSync(join(tmpdir(), 'knecht-workspace-')))).toThrow(/no Knecht environment config/)
  })
})
