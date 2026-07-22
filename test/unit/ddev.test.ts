import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it, vi } from 'vitest'
import { readDdevHosts, writeDdevConfig } from '../../server/daemon/ddev'
import { normalizeSharedFolder } from '../../server/utils/storage'

function checkout(configYaml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'knecht-ddev-'))
  mkdirSync(join(dir, '.ddev'))
  if (configYaml) writeFileSync(join(dir, '.ddev', 'config.yaml'), configYaml)
  return dir
}

describe('writeDdevConfig', () => {
  it('renames the project per run and injects env vars with one quote layer stripped', () => {
    const dir = checkout()
    const written = writeDdevConfig(dir, [
      { key: 'PRIMARY_SITE_URL', value: '"https://demo.ddev.site"' },
      { key: 'PLAIN', value: 'value' },
      { key: 'HALF', value: '"unbalanced' },
    ], 7, 'rewrite')
    expect(written).toBe(3)
    const doc = parse(readFileSync(join(dir, '.ddev', 'config.knecht.yaml'), 'utf8'))
    expect(doc.name).toBe('knecht-run-7')
    expect(doc.web_environment).toEqual([
      'PRIMARY_SITE_URL=https://demo.ddev.site',
      'PLAIN=value',
      'HALF="unbalanced',
    ])
  })

  it('translates ddev-host URLs in env values to preview origins in env mode', () => {
    vi.stubEnv('KNECHT_BASE_URL', 'http://lvh.me:3333')
    try {
      const dir = checkout('name: demo\nadditional_hostnames: [alpha]')
      writeDdevConfig(dir, [
        { key: 'PRIMARY_SITE_URL', value: 'https://demo.ddev.site' },
        { key: 'ALPHA_SITE_URL', value: 'https://alpha.ddev.site/en' },
        { key: 'COOKIE_DOMAIN', value: 'demo.ddev.site' },
        { key: 'OTHER', value: 'https://example.com/x' },
      ], 7, 'env')
      const doc = parse(readFileSync(join(dir, '.ddev', 'config.knecht.yaml'), 'utf8'))
      expect(doc.web_environment).toEqual([
        'PRIMARY_SITE_URL=http://7.preview.lvh.me:3333',
        'ALPHA_SITE_URL=http://alpha--7.preview.lvh.me:3333/en',
        'COOKIE_DOMAIN=7.preview.lvh.me',
        'OTHER=https://example.com/x',
      ])
    }
    finally {
      vi.unstubAllEnvs()
    }
  })

  it('omits web_environment entirely without env vars', () => {
    const dir = checkout()
    expect(writeDdevConfig(dir, [], 7)).toBe(0)
    const doc = parse(readFileSync(join(dir, '.ddev', 'config.knecht.yaml'), 'utf8'))
    expect(doc.web_environment).toBeUndefined()
  })

  it('writes the compose override: ingress network and resource caps', () => {
    const dir = checkout()
    writeDdevConfig(dir, [], 7)
    const compose = parse(readFileSync(join(dir, '.ddev', 'docker-compose.knecht.yaml'), 'utf8'))
    expect(compose.services.web.networks).toEqual({ 'knecht-ingress': {} })
    expect(compose.services.web.mem_limit).toBeDefined()
    expect(compose.services.db.mem_limit).toBeDefined()
    expect(compose.networks['knecht-ingress']).toEqual({ external: true })
  })

  it('bind-mounts shared folders writable and creates their host dirs', () => {
    const data = mkdtempSync(join(tmpdir(), 'knecht-data-'))
    vi.stubEnv('KNECHT_DATA_DIR', data)
    try {
      const dir = checkout()
      writeDdevConfig(dir, [], 7, 'env', { projectId: 5, folders: ['web/uploads', '/etc', ''] })
      const compose = parse(readFileSync(join(dir, '.ddev', 'docker-compose.knecht.yaml'), 'utf8'))
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
})
