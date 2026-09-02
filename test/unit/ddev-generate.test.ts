import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { configureSessionEnv, readDdevConfig } from '../../server/daemon/ddev'
import type { SessionEnvProject } from '../../server/daemon/ddev'

// What ends up in `.ddev/` for each kind of repo, byte for byte: the tracked
// case is the regression guard for every existing customer (Knecht must keep
// writing exactly the overrides it wrote before repos without ddev existed),
// the generated cases pin the config Knecht writes on their behalf.

const project = (overrides: Partial<SessionEnvProject> = {}): SessionEnvProject => ({
  id: 5,
  envVars: [],
  sharedFolders: [],
  phpVersion: null,
  nodeVersion: null,
  devServer: null,
  previewPort: null,
  ...overrides,
})

function repo(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'knecht-gen-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

// Every file under .ddev/, sorted, as one snapshot-able document.
function ddevTree(dir: string): string {
  const root = join(dir, '.ddev')
  const files: string[] = []
  const walk = (rel: string) => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const path = rel ? `${rel}/${name}` : name
      if (statSync(join(root, path)).isDirectory()) walk(path)
      else files.push(path)
    }
  }
  walk('')
  return files.map(f => `=== .ddev/${f} ===\n${readFileSync(join(root, f), 'utf8')}`).join('\n')
}

describe('configureSessionEnv', () => {
  it('generated-plain: a repo without anything gets a headless php project with defaults', () => {
    const dir = repo({ 'README.md': '# lib' })
    const { env, warnings, injected } = configureSessionEnv(dir, project(), 42, 'env')
    expect(env.source).toBe('generated')
    expect(warnings).toEqual([])
    expect(injected).toBe(0)
    expect(existsSync(join(dir, '.ddev', 'mysql'))).toBe(false)
    expect(ddevTree(dir)).toMatchSnapshot()
  })

  it('generated-with-versions: detected versions and an override land in config.yaml', () => {
    const dir = repo({
      'composer.json': '{ "require": { "php": "^8.1" } }',
      '.nvmrc': '20\n',
    })
    const { env } = configureSessionEnv(dir, project({ phpVersion: '8.2', envVars: [{ key: 'APP_ENV', value: 'dev' }] }), 42, 'env')
    expect(env.phpVersion).toEqual({ value: '8.2', source: 'setting' })
    expect(env.nodeVersion).toEqual({ value: '20', source: '.nvmrc' })
    expect(ddevTree(dir)).toMatchSnapshot()
  })

  it('ddev-tracked: a repo with its own config gets only the overrides, unchanged', () => {
    const dir = repo({
      '.ddev/config.yaml': 'name: demo\nadditional_hostnames: [alpha]\n',
    })
    const { env } = configureSessionEnv(dir, project({
      phpVersion: '8.1',
      envVars: [{ key: 'PRIMARY_SITE_URL', value: 'https://demo.ddev.site' }, { key: 'X', value: '"1"' }],
    }), 7, 'env')
    expect(env.source).toBe('ddev')
    // The override is ignored: the repo's config is the truth.
    expect(env.phpVersion.source).toBe('default')
    expect(ddevTree(dir)).toMatchSnapshot()
  })

  it('a config Knecht generated on an earlier boot is rewritten, not treated as the repo\'s', () => {
    const dir = repo({ 'composer.json': '{ "require": { "php": "8.2.*" } }' })
    configureSessionEnv(dir, project(), 42, 'env')
    const { env } = configureSessionEnv(dir, project({ nodeVersion: '18' }), 42, 'env')
    expect(env.source).toBe('generated')
    expect(readDdevConfig(dir)).toMatchObject({ generated: true, hasDb: false, phpVersion: '8.2', nodeVersion: '18', hosts: ['knecht-run-42.ddev.site'] })
  })
})
