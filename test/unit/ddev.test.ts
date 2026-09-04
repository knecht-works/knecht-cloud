import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'
import { devServerIsPreview, freeHostPorts, previewTargetPort, readDdevHosts, reservedHostPortsIn, writeDdevConfig } from '../../server/daemon/ddev'
import { normalizeSharedFolder } from '../../server/utils/storage'
import { resolveEnv, type ResolvedEnv } from '../../shared/utils/env-spec'

// A repo with its own ddev config, as the runner resolves it before writing.
function tracked(hosts: string[] = []): ResolvedEnv {
  return resolveEnv({
    source: 'ddev',
    fields: {
      hosts: { value: hosts, source: '.ddev/config.yaml' },
      hasDb: { value: true, source: '.ddev/config.yaml' },
    },
    warnings: [],
  }, { phpVersion: null, nodeVersion: null, devServer: null, previewPort: null })
}

function checkout(configYaml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'knecht-ddev-'))
  mkdirSync(join(dir, '.ddev'))
  if (configYaml) writeFileSync(join(dir, '.ddev', 'config.yaml'), configYaml)
  return dir
}

// The package manager caches every run shares on the host (daemon/ddev.ts).
const cacheEnv = [
  'pnpm_config_store_dir=/mnt/ddev-global-cache/pnpm-store',
  'YARN_CACHE_FOLDER=/mnt/ddev-global-cache/yarn',
  'YARN_GLOBAL_FOLDER=/mnt/ddev-global-cache/yarn-berry',
  'BUN_INSTALL_CACHE_DIR=/mnt/ddev-global-cache/bun',
]

// ddev's URL variables for a repo without ddev hostnames of its own: the
// preview is the primary (daemon/ddev.ts ddevUrlEnv).
const previewDdevEnv = [
  'DDEV_PRIMARY_URL=http://7.preview.knecht.test',
  'DDEV_PRIMARY_URL_WITHOUT_PORT=http://7.preview.knecht.test',
  'DDEV_PRIMARY_URL_PORT=80',
  'DDEV_SCHEME=http',
  'DDEV_HOSTNAME=7.preview.knecht.test',
  'XDEBUG_MODE=off',
]

describe('writeDdevConfig', () => {
  it('renames the project per run and injects env vars with one quote layer stripped', async () => {
    const dir = checkout()
    const written = await writeDdevConfig(dir, {
      sessionId: 7,
      env: tracked(),
      urlMode: 'rewrite',
      envVars: [
        { key: 'PRIMARY_SITE_URL', value: '"https://demo.ddev.site"' },
        { key: 'PLAIN', value: 'value' },
        { key: 'HALF', value: '"unbalanced' },
      ],
    })
    expect(written.injected).toBe(3)
    const doc = parse(readFileSync(join(dir, '.ddev', 'config.zzz-knecht.yaml'), 'utf8'))
    expect(doc.name).toBe('knecht-run-7')
    expect(doc.web_environment).toEqual([
      'PRIMARY_SITE_URL=https://demo.ddev.site',
      'PLAIN=value',
      'HALF="unbalanced',
      'KNECHT_PREVIEW_URL=http://7.preview.knecht.test',
      ...previewDdevEnv,
      ...cacheEnv,
    ])
  })

  it('translates ddev-host URLs in env values to preview origins in env mode', async () => {
    vi.stubEnv('KNECHT_BASE_URL', 'http://lvh.me:3333')
    try {
      const dir = checkout('name: demo\nadditional_hostnames: [alpha]')
      await writeDdevConfig(dir, {
        sessionId: 7,
        env: tracked(['demo.ddev.site', 'alpha.ddev.site']),
        urlMode: 'env',
        envVars: [
          { key: 'PRIMARY_SITE_URL', value: 'https://demo.ddev.site' },
          { key: 'ALPHA_SITE_URL', value: 'https://alpha.ddev.site/en' },
          { key: 'COOKIE_DOMAIN', value: 'demo.ddev.site' },
          { key: 'OTHER', value: 'https://example.com/x' },
        ],
      })
      const doc = parse(readFileSync(join(dir, '.ddev', 'config.zzz-knecht.yaml'), 'utf8'))
      expect(doc.web_environment).toEqual([
        'PRIMARY_SITE_URL=http://7.preview.lvh.me:3333',
        'ALPHA_SITE_URL=http://alpha--7.preview.lvh.me:3333/en',
        'COOKIE_DOMAIN=7.preview.lvh.me',
        'OTHER=https://example.com/x',
        'KNECHT_PREVIEW_URL=http://7.preview.lvh.me:3333',
        'KNECHT_URL_ALPHA=http://alpha--7.preview.lvh.me:3333',
        'DDEV_PRIMARY_URL=http://7.preview.lvh.me:3333',
        'DDEV_PRIMARY_URL_WITHOUT_PORT=http://7.preview.lvh.me',
        'DDEV_PRIMARY_URL_PORT=3333',
        'DDEV_SCHEME=http',
        'DDEV_HOSTNAME=7.preview.lvh.me,alpha--7.preview.lvh.me',
        'XDEBUG_MODE=off',
        ...cacheEnv,
      ])
    }
    finally {
      vi.unstubAllEnvs()
    }
  })

  it('writes only the session variables and the cache paths without env vars', async () => {
    const dir = checkout()
    expect((await writeDdevConfig(dir, { sessionId: 7, env: tracked(), envVars: [], urlMode: 'env' })).injected).toBe(0)
    const doc = parse(readFileSync(join(dir, '.ddev', 'config.zzz-knecht.yaml'), 'utf8'))
    expect(doc.web_environment).toEqual(['KNECHT_PREVIEW_URL=http://7.preview.knecht.test', ...previewDdevEnv, ...cacheEnv])
  })

  it('frees pinned host ports with real distinct ports (a shared "0" collides in ddev\'s own port bookkeeping) and switches xdebug off, unless the project says otherwise', async () => {
    const dir = checkout()
    await writeDdevConfig(dir, { sessionId: 7, env: tracked(), envVars: [{ key: 'XDEBUG_MODE', value: 'debug' }], urlMode: 'env' })
    const doc = parse(readFileSync(join(dir, '.ddev', 'config.zzz-knecht.yaml'), 'utf8'))
    const ports = [doc.host_db_port, doc.host_webserver_port, doc.host_https_port, doc.host_mailpit_port]
    for (const port of ports) expect(port).toMatch(/^\d+$/)
    expect(new Set(ports).size).toBe(4)
    expect(doc.web_environment.filter((l: string) => l.startsWith('XDEBUG_MODE'))).toEqual(['XDEBUG_MODE=debug'])
  })

  it('removes the override files from before the zzz- rename, and counts that as a change', async () => {
    const dir = checkout()
    writeFileSync(join(dir, '.ddev', 'config.knecht.yaml'), 'web_environment:\n  - STALE=1\n')
    writeFileSync(join(dir, '.ddev', 'docker-compose.knecht.yaml'), 'services: {}\n')
    await writeDdevConfig(dir, { sessionId: 7, env: tracked(), envVars: [], urlMode: 'env' })
    expect(existsSync(join(dir, '.ddev', 'config.knecht.yaml'))).toBe(false)
    expect(existsSync(join(dir, '.ddev', 'docker-compose.knecht.yaml'))).toBe(false)
    expect((await writeDdevConfig(dir, { sessionId: 7, env: tracked(), envVars: [], urlMode: 'env' })).changed).toBe(false)
    writeFileSync(join(dir, '.ddev', 'config.knecht.yaml'), 'web_environment:\n  - STALE=1\n')
    expect((await writeDdevConfig(dir, { sessionId: 7, env: tracked(), envVars: [], urlMode: 'env' })).changed).toBe(true)
  })

  it('writes the compose override: ingress network and resource caps', async () => {
    const dir = checkout()
    await writeDdevConfig(dir, { sessionId: 7, env: tracked(), envVars: [], urlMode: 'env' })
    const compose = parse(readFileSync(join(dir, '.ddev', 'docker-compose.zzz-knecht.yaml'), 'utf8'))
    expect(compose.services.web.networks).toEqual({ 'knecht-ingress': {} })
    expect(compose.services.web.mem_limit).toBeDefined()
    expect(compose.services.db.mem_limit).toBeDefined()
    expect(compose.networks['knecht-ingress']).toEqual({ external: true })
  })

  it('writes the low-memory db config into the mysql includedir', async () => {
    const dir = checkout()
    await writeDdevConfig(dir, { sessionId: 7, env: tracked(), envVars: [], urlMode: 'env' })
    const cnf = readFileSync(join(dir, '.ddev', 'mysql', '00-knecht-lowmem.cnf'), 'utf8')
    expect(cnf).toContain('#ddev-silent-no-warn')
    expect(cnf).toContain('innodb-buffer-pool-size = 256M')
    expect(cnf).toContain('performance_schema = OFF')
  })

  it('bind-mounts shared folders writable and creates their host dirs', async () => {
    const data = mkdtempSync(join(tmpdir(), 'knecht-data-'))
    vi.stubEnv('KNECHT_DATA_DIR', data)
    try {
      const dir = checkout()
      await writeDdevConfig(dir, { sessionId: 7, env: tracked(), envVars: [], urlMode: 'env', shared: { projectId: 5, folders: ['web/uploads', '/etc', ''] } })
      const compose = parse(readFileSync(join(dir, '.ddev', 'docker-compose.zzz-knecht.yaml'), 'utf8'))
      const host = join(data, 'shared', '5', 'web/uploads')
      expect(compose.services.web.volumes).toContain(`${host}:/var/www/html/web/uploads`)
      // Invalid paths are dropped, and there is no read-only suffix.
      expect(compose.services.web.volumes.filter((v: string) => !v.endsWith(':ro'))).toHaveLength(1)
      // The host dir exists (docker would create a root-owned one otherwise).
      expect(existsSync(host)).toBe(true)
    }
    finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('normalizeSharedFolder', () => {
  it('normalizes relative paths', () => {
    expect(normalizeSharedFolder('web/uploads')).toBe('web/uploads')
    expect(normalizeSharedFolder(' ./web//uploads/ ')).toBe('web/uploads')
    expect(normalizeSharedFolder('storage\\rebrand')).toBe('storage/rebrand')
  })

  it('rejects empty, absolute and escaping paths and knecht internals', () => {
    for (const bad of ['', '  ', '/etc', 'C:/x', 'a/../../b', '..', '.git/hooks', '.ddev/x', '.knecht']) {
      expect(normalizeSharedFolder(bad)).toBeNull()
    }
  })
})

describe('readDdevHosts', () => {
  it('collects the primary host plus additional hostnames and fqdns', () => {
    const dir = checkout([
      'name: demo',
      'additional_hostnames:',
      '  - alpha',
      '  - beta.demo',
      'additional_fqdns:',
      '  - www.example.com',
    ].join('\n'))
    expect(readDdevHosts(dir)).toEqual({
      primary: 'demo.ddev.site',
      all: ['demo.ddev.site', 'alpha.ddev.site', 'beta.demo.ddev.site', 'www.example.com'],
    })
  })

  it('honors a custom project_tld', () => {
    const dir = checkout('name: demo\nproject_tld: test\nadditional_hostnames: [alpha]')
    expect(readDdevHosts(dir)).toEqual({ primary: 'demo.test', all: ['demo.test', 'alpha.test'] })
  })

  it('degrades to nulls on a missing or nameless config', () => {
    expect(readDdevHosts(checkout())).toEqual({ primary: null, all: [] })
    expect(readDdevHosts(checkout('webserver_type: nginx-fpm'))).toEqual({ primary: null, all: [] })
  })

  it('serves no host for a config Knecht generated: the proxy passes the preview host through', () => {
    expect(readDdevHosts(checkout('#knecht-generated\nname: knecht-run-7\n'))).toEqual({ primary: null, all: [] })
  })
})

describe('previewTargetPort', () => {
  const generated = { previewHosts: [], previewPort: 3000 }
  const trackedWithDev = { previewHosts: ['demo.ddev.site'], previewPort: 5173 }
  const trackedPlain = { previewHosts: ['demo.ddev.site'], previewPort: null }

  it('serves a generated environment from its dev server, a repo with its own config from its web server', () => {
    expect(devServerIsPreview(generated)).toBe(true)
    expect(devServerIsPreview(trackedWithDev)).toBe(false)
    expect(devServerIsPreview({ previewHosts: [], previewPort: null })).toBe(false)
    expect(previewTargetPort(generated)).toBe(41000)
    expect(previewTargetPort(trackedWithDev)).toBe(80)
    expect(previewTargetPort(trackedPlain)).toBe(80)
  })

  it('reaches the dev server through the forwarder on the dev origin, whatever the environment', () => {
    expect(previewTargetPort(trackedWithDev, true)).toBe(41000)
    expect(previewTargetPort(generated, true)).toBe(41000)
  })
})

describe('env value references', () => {
  it('lets a project line for a session variable win', async () => {
    const dir = checkout()
    await writeDdevConfig(dir, { sessionId: 7, env: tracked(), envVars: [
      { key: 'KNECHT_PREVIEW_URL', value: 'https://staging.example.com' },
    ], urlMode: 'env' })
    const doc = parse(readFileSync(join(dir, '.ddev', 'config.zzz-knecht.yaml'), 'utf8'))
    expect(doc.web_environment.filter((l: string) => l.startsWith('KNECHT_PREVIEW_URL'))).toEqual(['KNECHT_PREVIEW_URL=https://staging.example.com'])
  })

  it('resolves a per-host session variable', async () => {
    const dir = checkout()
    await writeDdevConfig(dir, { sessionId: 7, env: tracked(['demo.ddev.site', 'alpha.ddev.site']), envVars: [
      { key: 'ALPHA_URL', value: '${KNECHT_URL_ALPHA}/de' },
    ], urlMode: 'env' })
    const doc = parse(readFileSync(join(dir, '.ddev', 'config.zzz-knecht.yaml'), 'utf8'))
    expect(doc.web_environment[0]).toBe('ALPHA_URL=http://alpha--7.preview.knecht.test/de')
  })

  it('expands $NAME from the session and earlier lines, keeps unknown names and escapes $ for compose', async () => {
    const dir = checkout()
    await writeDdevConfig(dir, {
      sessionId: 7,
      env: tracked(),
      envVars: [
        { key: 'APP_URL', value: '$KNECHT_PREVIEW_URL' },
        { key: 'SITE_URL', value: '${APP_URL}/en' },
        { key: 'PASS', value: 'pa$$word' },
        { key: 'OTHER', value: '$UNKNOWN' },
      ],
      urlMode: 'env',
    })
    const doc = parse(readFileSync(join(dir, '.ddev', 'config.zzz-knecht.yaml'), 'utf8'))
    expect(doc.web_environment.slice(0, 4)).toEqual([
      'APP_URL=http://7.preview.knecht.test',
      'SITE_URL=http://7.preview.knecht.test/en',
      'PASS=pa$$$$word',
      'OTHER=$$UNKNOWN',
    ])
  })
})

describe('ddev URL variables', () => {
  const read = (dir: string) => (parse(readFileSync(join(dir, '.ddev', 'config.zzz-knecht.yaml'), 'utf8')).web_environment as string[])
    .filter(l => l.startsWith('DDEV_'))

  it('point at the preview origins in env mode, port and scheme included', async () => {
    const dir = checkout()
    await writeDdevConfig(dir, { sessionId: 7, env: tracked(['demo.ddev.site', 'alpha.ddev.site']), envVars: [], urlMode: 'env' })
    expect(read(dir)).toEqual([
      'DDEV_PRIMARY_URL=http://7.preview.knecht.test',
      'DDEV_PRIMARY_URL_WITHOUT_PORT=http://7.preview.knecht.test',
      'DDEV_PRIMARY_URL_PORT=80',
      'DDEV_SCHEME=http',
      'DDEV_HOSTNAME=7.preview.knecht.test,alpha--7.preview.knecht.test',
    ])
  })

  it('are what ddev writes locally in rewrite mode', async () => {
    const dir = checkout()
    await writeDdevConfig(dir, { sessionId: 7, env: tracked(['demo.ddev.site', 'alpha.ddev.site']), envVars: [], urlMode: 'rewrite' })
    expect(read(dir)).toEqual([
      'DDEV_PRIMARY_URL=https://demo.ddev.site',
      'DDEV_PRIMARY_URL_WITHOUT_PORT=https://demo.ddev.site',
      'DDEV_PRIMARY_URL_PORT=443',
      'DDEV_SCHEME=https',
      'DDEV_HOSTNAME=demo.ddev.site,alpha.ddev.site',
    ])
  })

  it('a project line wins and can reference them', async () => {
    const dir = checkout()
    await writeDdevConfig(dir, { sessionId: 7, env: tracked(['demo.ddev.site']), envVars: [
      { key: 'DDEV_SCHEME', value: 'https' },
      { key: 'APP_URL', value: '$DDEV_PRIMARY_URL' },
    ], urlMode: 'env' })
    const lines = parse(readFileSync(join(dir, '.ddev', 'config.zzz-knecht.yaml'), 'utf8')).web_environment as string[]
    expect(lines.filter(l => l.startsWith('DDEV_SCHEME'))).toEqual(['DDEV_SCHEME=https'])
    expect(lines).toContain('APP_URL=http://7.preview.knecht.test')
  })
})

describe('freeHostPorts', () => {
  it('reads every project\'s used_host_ports from ddev\'s registry, and nothing from a broken one', () => {
    const registry = [
      'knecht-run-5:',
      '    approot: /data/knecht/projects/run-5',
      '    used_host_ports: ["41213", "40939", "42285"]',
      'knecht-run-6:',
      '    approot: /data/knecht/projects/run-6',
      '    used_host_ports: ["36865", "37521", "38293"]',
      'legacy:',
      '    approot: /somewhere',
    ].join('\n')
    expect([...reservedHostPortsIn(registry)].sort()).toEqual([36865, 37521, 38293, 40939, 41213, 42285].sort())
    expect(reservedHostPortsIn('')).toEqual(new Set())
    expect(reservedHostPortsIn('[not: a: map')).toEqual(new Set())
  })

  it('probes past ports ddev has reserved, stopped projects included (they bind nothing, so the host says free)', async () => {
    // Whatever the host hands out first counts as reserved: the result must
    // then be other ports, still distinct.
    const seen = new Set<number>()
    const reserved = {
      has(port: number) {
        if (seen.size < 3) {
          seen.add(port)
          return true
        }
        return false
      },
    } as Set<number>
    const ports = await freeHostPorts(4, reserved)
    expect(ports).toHaveLength(4)
    expect(new Set(ports).size).toBe(4)
    for (const port of ports) expect(seen.has(port)).toBe(false)
  })
})
