import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { configureSessionEnv, devDaemonCommand, readDdevConfig } from '../../server/daemon/ddev'
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
  return files
    .map(f => `=== .ddev/${f} ===\n${readFileSync(join(root, f), 'utf8')}`)
    .join('\n')
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

  it('generated-with-devserver: the daemon and the preview env', () => {
    const dir = repo({ 'mise.toml': '[tools]\nnode = "22"\n' })
    const { env, devServerPort } = configureSessionEnv(dir, project({ devServer: 'npm run dev', previewPort: 3000 }), 42, 'env')
    expect(env.previewPort).toEqual({ value: 3000, source: 'setting' })
    expect(devServerPort).toBe(3000)
    expect(ddevTree(dir)).toMatchSnapshot()
  })

  it('generated-with-bun: the repo\'s bun goes into the web image at the pinned version', () => {
    const dir = repo({ 'package.json': '{ "packageManager": "bun@1.2.3" }', 'bun.lock': '{}' })
    const { env } = configureSessionEnv(dir, project(), 42, 'env')
    expect(env.packageManager).toEqual({ value: { name: 'bun', version: '1.2.3' }, source: 'package.json' })
    expect(ddevTree(dir)).toMatchSnapshot()
  })

  it('bun without a pinned version installs latest, and the image file goes away when the repo stops using bun', () => {
    const dir = repo({ 'bun.lock': '{}' })
    configureSessionEnv(dir, project(), 42, 'env')
    const dockerfile = join(dir, '.ddev', 'web-build', 'Dockerfile.knecht')
    expect(readFileSync(dockerfile, 'utf8')).toBe('RUN npm install -g bun@latest\n')
    expect(configureSessionEnv(dir, project(), 42, 'env').changed).toBe(false)
    rmSync(join(dir, 'bun.lock'))
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    const { env, changed } = configureSessionEnv(dir, project(), 42, 'env')
    expect(env.packageManager).toEqual({ value: { name: 'pnpm', version: null }, source: 'pnpm-lock.yaml' })
    expect(changed).toBe(true)
    expect(existsSync(dockerfile)).toBe(false)
  })

  it('a repo using pnpm also gets the npm-style store path pnpm 9 and 10 read, other repos do not', () => {
    const readEnv = (dir: string) => parse(readFileSync(join(dir, '.ddev', 'config.knecht.yaml'), 'utf8')).web_environment as string[]
    const pnpm = repo({ 'pnpm-lock.yaml': '' })
    configureSessionEnv(pnpm, project(), 42, 'env')
    expect(readEnv(pnpm)).toContain('npm_config_store_dir=/mnt/ddev-global-cache/pnpm-store')
    const npm = repo({ 'package-lock.json': '{}' })
    configureSessionEnv(npm, project(), 42, 'env')
    expect(readEnv(npm)).not.toContain('npm_config_store_dir=/mnt/ddev-global-cache/pnpm-store')
    expect(readEnv(npm)).toContain('pnpm_config_store_dir=/mnt/ddev-global-cache/pnpm-store')
  })

  it('a dev server without a port, a port without a command, or a repo with its own ddev config: no daemon, no port', () => {
    const noPort = repo()
    expect(configureSessionEnv(noPort, project({ devServer: 'npm run dev' }), 42, 'env').devServerPort).toBeNull()
    expect(ddevTree(noPort)).not.toContain('web_extra_daemons')
    const noCommand = repo()
    expect(configureSessionEnv(noCommand, project({ previewPort: 3000 }), 42, 'env').devServerPort).toBeNull()
    expect(ddevTree(noCommand)).not.toContain('web_extra_daemons')
    expect(existsSync(join(noCommand, '.ddev', 'web-build', 'Dockerfile.knecht'))).toBe(false)
    const tracked = repo({ '.ddev/config.yaml': 'name: demo\n' })
    expect(configureSessionEnv(tracked, project({ devServer: 'npm run dev', previewPort: 3000 }), 7, 'env').devServerPort).toBeNull()
    expect(ddevTree(tracked)).not.toContain('web_extra_daemons')
  })

  it('a config Knecht generated on an earlier boot is rewritten, not treated as the repo\'s', () => {
    const dir = repo({ 'composer.json': '{ "require": { "php": "8.2.*" } }' })
    configureSessionEnv(dir, project(), 42, 'env')
    const { env } = configureSessionEnv(dir, project({ nodeVersion: '18' }), 42, 'env')
    expect(env.source).toBe('generated')
    expect(readDdevConfig(dir)).toMatchObject({ generated: true, hasDb: false, phpVersion: '8.2', nodeVersion: '18', hosts: ['knecht-run-42.ddev.site'] })
  })

  it('reports whether the environment definition changed since the last write', () => {
    const dir = repo({ 'package.json': '{}' })
    expect(configureSessionEnv(dir, project(), 42, 'env').changed).toBe(true)
    expect(configureSessionEnv(dir, project(), 42, 'env').changed).toBe(false)
    expect(configureSessionEnv(dir, project({ phpVersion: '8.2' }), 42, 'env').changed).toBe(true)
    expect(configureSessionEnv(dir, project({ phpVersion: '8.2', devServer: 'npm run dev', previewPort: 3000 }), 42, 'env').changed).toBe(true)
    expect(configureSessionEnv(dir, project({ phpVersion: '8.2', devServer: 'npm run dev', previewPort: 3000 }), 42, 'env').changed).toBe(false)
    expect(configureSessionEnv(dir, project({ phpVersion: '8.2' }), 42, 'env').changed).toBe(true)
  })
})

describe('devDaemonCommand', () => {
  it('wraps the command in a login shell and survives both quoting layers', () => {
    expect(devDaemonCommand('npm run dev')).toBe(`bash -lc 'npm run dev'`)
    // Single quotes close and reopen the inner string ('\\''); that backslash,
    // double quotes and $ are then escaped once more for ddev's outer
    // `bash -c "..."`, which unescapes them before the inner bash sees them.
    expect(devDaemonCommand(`node -e 'console.log("$HOME")'`))
      .toBe(String.raw`bash -lc 'node -e '\\''console.log(\"\$HOME\")'\\'''`)
  })
})
