import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { readDdevHosts, writeDdevConfig } from '../../server/daemon/ddev'

function checkout(configYaml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'knecht-ddev-'))
  mkdirSync(join(dir, '.ddev'))
  if (configYaml) writeFileSync(join(dir, '.ddev', 'config.yaml'), configYaml)
  return dir
}

describe('writeDdevConfig', () => {
  it('pins the router ports and injects env vars with one quote layer stripped', () => {
    const dir = checkout()
    const written = writeDdevConfig(dir, [
      { key: 'PRIMARY_SITE_URL', value: '"https://demo.ddev.site"' },
      { key: 'PLAIN', value: 'value' },
      { key: 'HALF', value: '"unbalanced' },
    ])
    expect(written).toBe(3)
    const doc = parse(readFileSync(join(dir, '.ddev', 'config.knecht.yaml'), 'utf8'))
    expect(doc.router_http_port).toBe('80')
    expect(doc.router_https_port).toBe('443')
    expect(doc.web_environment).toEqual([
      'PRIMARY_SITE_URL=https://demo.ddev.site',
      'PLAIN=value',
      'HALF="unbalanced',
    ])
  })

  it('omits web_environment entirely without env vars', () => {
    const dir = checkout()
    expect(writeDdevConfig(dir, [])).toBe(0)
    const doc = parse(readFileSync(join(dir, '.ddev', 'config.knecht.yaml'), 'utf8'))
    expect(doc.web_environment).toBeUndefined()
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
