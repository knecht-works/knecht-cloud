import type { Octokit } from 'octokit'
import { describe, expect, it } from 'vitest'
import { resolveProjectMeta } from '../../server/utils/framework'
import { repoReader } from '../../server/utils/github'

function octokitWith(files: Record<string, string>, fail?: number): Octokit {
  return {
    rest: {
      repos: {
        getContent: async ({ path }: { path: string }) => {
          if (fail) throw Object.assign(new Error('boom'), { status: fail })
          const file = files[path]
          if (file === undefined) throw Object.assign(new Error('Not Found'), { status: 404 })
          return { data: { type: 'file', content: Buffer.from(file).toString('base64') } }
        },
      },
      git: { getTree: async () => ({ data: { tree: [] } }) },
    },
  } as unknown as Octokit
}

describe('repoReader', () => {
  it('reads the detection files, missing ones as null', async () => {
    const read = await repoReader(octokitWith({ '.nvmrc': '20\n' }), 'o', 'r')
    expect(read('.nvmrc')).toBe('20\n')
    expect(read('composer.json')).toBeNull()
  })

  it('rejects on anything but a 404', async () => {
    await expect(repoReader(octokitWith({}, 403), 'o', 'r')).rejects.toThrow('boom')
  })
})

describe('resolveProjectMeta', () => {
  it('describes a repo with its own ddev config from that file', async () => {
    const meta = await resolveProjectMeta(octokitWith({
      '.ddev/config.yaml': 'name: demo\ntype: craftcms\nphp_version: "8.3"\ndatabase: { type: mariadb, version: "10.11" }\n',
      'package.json': '{ "packageManager": "pnpm@9.1.0" }',
    }), 'o', 'r')
    expect(meta.framework).toBe('craftcms')
    expect(meta.ddevEnv).toMatchObject({
      webserver: 'nginx-fpm',
      phpVersion: '8.3',
      dbType: 'mariadb',
      dbVersion: '10.11',
      packageManager: 'pnpm@9.1.0',
      detected: { source: 'ddev', fields: { phpVersion: { value: '8.3', source: '.ddev/config.yaml' } }, warnings: [] },
    })
    expect(meta.favicon).toBe('')
  })

  it('describes a repo without ddev from its other files, framework unknown', async () => {
    const meta = await resolveProjectMeta(octokitWith({
      'composer.json': '{ "require": { "php": "^8.2" } }',
      '.nvmrc': 'lts/*\n',
    }), 'o', 'r')
    expect(meta.framework).toBeNull()
    expect(meta.ddevEnv).toMatchObject({
      webserver: null,
      phpVersion: '8.4',
      nodeVersion: null,
      detected: {
        source: 'generated',
        fields: { phpVersion: { value: '8.4', source: 'composer.json' } },
        warnings: [expect.stringContaining('lts/*')],
      },
    })
  })

  it('detects the framework from composer.json over the ddev type', async () => {
    const meta = await resolveProjectMeta(octokitWith({
      '.ddev/config.yaml': 'name: demo\ntype: laravel\n',
      'composer.json': '{ "require": { "craftcms/cms": "^5.0" } }',
      'composer.lock': '{ "packages": [{ "name": "craftcms/cms", "version": "5.4.2" }] }',
    }), 'o', 'r')
    expect(meta.framework).toBe('craftcms')
    expect(meta.frameworkVersion).toBe('5.4')
  })

  it('detects Kirby from composer.json behind a plain php ddev type', async () => {
    const meta = await resolveProjectMeta(octokitWith({
      '.ddev/config.yaml': 'name: demo\ntype: php\n',
      'composer.json': '{ "require": { "getkirby/cms": "^4.0" } }',
      'composer.lock': '{ "packages": [{ "name": "getkirby/cms", "version": "4.3.1" }] }',
    }), 'o', 'r')
    expect(meta.framework).toBe('kirby')
    expect(meta.frameworkVersion).toBe('4.3')
  })

  it('detects the framework from package.json devDependencies without a ddev type', async () => {
    const meta = await resolveProjectMeta(octokitWith({
      '.ddev/config.yaml': 'name: demo\n',
      'package.json': '{ "dependencies": { "vue": "^3.5.0" }, "devDependencies": { "nuxt": "^3.12.4" } }',
    }), 'o', 'r')
    expect(meta.framework).toBe('nuxt')
    expect(meta.frameworkVersion).toBe('3.12')
  })

  it('falls back to the ddev type when no known package is required', async () => {
    const meta = await resolveProjectMeta(octokitWith({
      '.ddev/config.yaml': 'name: demo\ntype: php\n',
      'composer.json': '{ "require": { "php": "^8.2" } }',
      'package.json': 'not json',
    }), 'o', 'r')
    expect(meta.framework).toBe('php')
    expect(meta.frameworkVersion).toBeNull()
  })

  it('keeps a repo with an unparseable ddev config a ddev project, framework unknown', async () => {
    const meta = await resolveProjectMeta(octokitWith({ '.ddev/config.yaml': 'name: [' }), 'o', 'r')
    expect(meta.framework).toBeNull()
    expect(meta.ddevEnv.detected?.source).toBe('ddev')
    expect(meta.ddevEnv.detected?.warnings).toEqual([expect.stringContaining('could not be parsed')])
  })
})
