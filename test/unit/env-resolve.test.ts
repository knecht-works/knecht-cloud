import { describe, expect, it } from 'vitest'
import { type DetectedEnv, type EnvOverrides, formatEnvSummary, formatPackageManager, projectDetectedEnv, resolveEnv, sourceLabel } from '../../shared/utils/env-spec'

const none: EnvOverrides = { phpVersion: null, nodeVersion: null, packageManager: null, devServer: null, previewPort: null }

const generated: DetectedEnv = {
  source: 'generated',
  fields: {
    phpVersion: { value: '8.2', source: 'composer.json' },
    nodeVersion: { value: '20', source: '.nvmrc' },
  },
  warnings: [],
}

const tracked: DetectedEnv = {
  source: 'ddev',
  fields: {
    hosts: { value: ['demo.ddev.site', 'alpha.ddev.site'], source: '.ddev/config.yaml' },
    hasDb: { value: true, source: '.ddev/config.yaml' },
    phpVersion: { value: '8.3', source: '.ddev/config.yaml' },
  },
  warnings: [],
}

describe('resolveEnv', () => {
  it('starts every field at its default when nothing was detected', () => {
    const env = resolveEnv({ source: 'generated', fields: {}, warnings: [] }, none)
    expect(env).toEqual({
      source: 'generated',
      phpVersion: { value: '8.4', source: 'default' },
      nodeVersion: { value: '22', source: 'default' },
      packageManager: { value: { name: 'npm', version: null }, source: 'default' },
      hasDb: { value: false, source: 'default' },
      hosts: { value: [], source: 'default' },
      devServer: { value: null, source: 'default' },
      previewPort: { value: null, source: 'default' },
    })
  })

  it('detection beats the default, setting beats detection', () => {
    const env = resolveEnv(generated, { ...none, phpVersion: '8.1' })
    expect(env.phpVersion).toEqual({ value: '8.1', source: 'setting' })
    expect(env.nodeVersion).toEqual({ value: '20', source: '.nvmrc' })
    expect(env.hasDb).toEqual({ value: false, source: 'default' })
  })

  it('dev server settings are settings too', () => {
    const env = resolveEnv(generated, { ...none, devServer: 'mise run dev', previewPort: 3000 })
    expect(env.devServer).toEqual({ value: 'mise run dev', source: 'setting' })
    expect(env.previewPort).toEqual({ value: 3000, source: 'setting' })
  })

  it('takes the package manager from detection unless a setting names another one', () => {
    const pinned = {
      ...generated,
      fields: { ...generated.fields, packageManager: { value: { name: 'pnpm', version: '9.1.0' }, source: 'package.json' } },
    }
    expect(resolveEnv(pinned, none).packageManager).toEqual({ value: { name: 'pnpm', version: '9.1.0' }, source: 'package.json' })
    // The repo's pin only applies to the tool it pins.
    expect(resolveEnv(pinned, { ...none, packageManager: 'pnpm' }).packageManager).toEqual({ value: { name: 'pnpm', version: '9.1.0' }, source: 'setting' })
    expect(resolveEnv(pinned, { ...none, packageManager: 'bun' }).packageManager).toEqual({ value: { name: 'bun', version: null }, source: 'setting' })
  })

  it('ignores the version overrides for a ddev project (the committed config is the truth) but keeps its dev server', () => {
    const env = resolveEnv(tracked, { phpVersion: '8.1', nodeVersion: '18', packageManager: 'bun', devServer: 'npm run dev', previewPort: 3000 })
    expect(env.source).toBe('ddev')
    expect(env.phpVersion).toEqual({ value: '8.3', source: '.ddev/config.yaml' })
    expect(env.nodeVersion).toEqual({ value: '22', source: 'default' })
    expect(env.packageManager).toEqual({ value: { name: 'npm', version: null }, source: 'default' })
    expect(env.hosts.value).toEqual(['demo.ddev.site', 'alpha.ddev.site'])
    expect(env.hasDb).toEqual({ value: true, source: '.ddev/config.yaml' })
    expect(env.devServer).toEqual({ value: 'npm run dev', source: 'setting' })
    expect(env.previewPort).toEqual({ value: 3000, source: 'setting' })
    expect(resolveEnv(tracked, none).devServer).toEqual({ value: null, source: 'default' })
  })
})

describe('formatEnvSummary', () => {
  it('spells out a generated env with the source of every value', () => {
    expect(formatEnvSummary(resolveEnv(generated, { ...none, phpVersion: '8.1' })))
      .toBe('generated: PHP 8.1 from setting, Node 20 from .nvmrc, npm default, no database, no dev server')
  })

  it('names the dev server and its port', () => {
    expect(formatEnvSummary(resolveEnv(generated, { ...none, devServer: 'mise run dev', previewPort: 3000 })))
      .toBe('generated: PHP 8.2 from composer.json, Node 20 from .nvmrc, npm default, no database, dev server \'mise run dev\' on port 3000')
  })

  it('names the package manager with the version the repo pins', () => {
    const pinned: DetectedEnv = {
      ...generated,
      fields: {
        ...generated.fields,
        packageManager: { value: { name: 'pnpm', version: '9.1.0' }, source: 'package.json' },
      },
    }
    expect(formatEnvSummary(resolveEnv(pinned, none)))
      .toBe('generated: PHP 8.2 from composer.json, Node 20 from .nvmrc, pnpm 9.1.0 from package.json, no database, no dev server')
    expect(formatPackageManager({ name: 'pnpm', version: '9.1.0' })).toBe('pnpm 9.1.0')
    expect(formatPackageManager({ name: 'npm', version: null })).toBe('npm')
  })

  it('points at the repo config for ddev projects, naming a dev server next to it', () => {
    expect(formatEnvSummary(resolveEnv(tracked, none)))
      .toBe('from .ddev/config.yaml: hosts demo.ddev.site, alpha.ddev.site')
    expect(formatEnvSummary(resolveEnv({ ...tracked, fields: {} }, none)))
      .toBe('from .ddev/config.yaml')
    expect(formatEnvSummary(resolveEnv(tracked, { ...none, devServer: 'npm run dev', previewPort: 5173 })))
      .toBe('from .ddev/config.yaml: hosts demo.ddev.site, alpha.ddev.site, dev server \'npm run dev\' on port 5173')
    expect(formatEnvSummary(resolveEnv({ ...tracked, fields: {} }, { ...none, devServer: 'npm run dev', previewPort: 5173 })))
      .toBe('from .ddev/config.yaml: dev server \'npm run dev\' on port 5173')
  })
})

describe('sourceLabel', () => {
  it('reads as a suffix', () => {
    expect(sourceLabel('default')).toBe('default')
    expect(sourceLabel('setting')).toBe('from setting')
    expect(sourceLabel('composer.json')).toBe('from composer.json')
  })
})

describe('projectDetectedEnv', () => {
  it('hands back the stored detection', () => {
    expect(projectDetectedEnv({ detected: generated })).toBe(generated)
  })

  it('treats rows from before detection existed as ddev projects with a database', () => {
    for (const env of [null, undefined, {}]) {
      const detected = projectDetectedEnv(env)
      expect(detected.source).toBe('ddev')
      expect(resolveEnv(detected, none).hasDb.value).toBe(true)
    }
  })
})
