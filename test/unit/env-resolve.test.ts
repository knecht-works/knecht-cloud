import { describe, expect, it } from 'vitest'
import { type DetectedEnv, type EnvOverrides, formatEnvSummary, projectDetectedEnv, resolveEnv, sourceLabel } from '../../shared/utils/env-spec'

const none: EnvOverrides = { phpVersion: null, nodeVersion: null, devServer: null, previewPort: null }

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

  it('ignores every override for a ddev project: the committed config is the truth', () => {
    const env = resolveEnv(tracked, { phpVersion: '8.1', nodeVersion: '18', devServer: 'npm run dev', previewPort: 3000 })
    expect(env.source).toBe('ddev')
    expect(env.phpVersion).toEqual({ value: '8.3', source: '.ddev/config.yaml' })
    expect(env.nodeVersion).toEqual({ value: '22', source: 'default' })
    expect(env.hosts.value).toEqual(['demo.ddev.site', 'alpha.ddev.site'])
    expect(env.hasDb).toEqual({ value: true, source: '.ddev/config.yaml' })
    expect(env.devServer).toEqual({ value: null, source: 'default' })
    expect(env.previewPort).toEqual({ value: null, source: 'default' })
  })
})

describe('formatEnvSummary', () => {
  it('spells out a generated env with the source of every value', () => {
    expect(formatEnvSummary(resolveEnv(generated, { ...none, phpVersion: '8.1' })))
      .toBe('generated: PHP 8.1 from setting, Node 20 from .nvmrc, no database, no dev server')
  })

  it('names the dev server and its port', () => {
    expect(formatEnvSummary(resolveEnv(generated, { ...none, devServer: 'mise run dev', previewPort: 3000 })))
      .toBe('generated: PHP 8.2 from composer.json, Node 20 from .nvmrc, no database, dev server \'mise run dev\' on port 3000')
  })

  it('points at the repo config for ddev projects', () => {
    expect(formatEnvSummary(resolveEnv(tracked, none)))
      .toBe('from .ddev/config.yaml: hosts demo.ddev.site, alpha.ddev.site')
    expect(formatEnvSummary(resolveEnv({ ...tracked, fields: {} }, none)))
      .toBe('from .ddev/config.yaml')
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
