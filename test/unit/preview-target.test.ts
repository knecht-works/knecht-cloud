import { describe, expect, it } from 'vitest'
import { hasPreviewTarget } from '../../server/utils/preview-target'

const ddevProject = { ddevEnv: { source: 'ddev' as const, webserver: 'nginx-fpm', phpVersion: null, dbType: null, dbVersion: null, nodeVersion: null, packageManager: null }, previewPort: null }
const generatedProject = { ...ddevProject, ddevEnv: { ...ddevProject.ddevEnv, source: 'generated' as const } }
const unbooted = { previewHosts: [], previewPort: null, envState: 'down' as const }

describe('hasPreviewTarget', () => {
  it('a booted session decides by its pinned hosts or port', () => {
    expect(hasPreviewTarget({ ...unbooted, previewHosts: ['demo.ddev.site'], envState: 'up' }, generatedProject)).toBe(true)
    expect(hasPreviewTarget({ ...unbooted, previewPort: 3000, envState: 'up' }, generatedProject)).toBe(true)
    expect(hasPreviewTarget({ ...unbooted, envState: 'up' }, ddevProject)).toBe(false)
    expect(hasPreviewTarget({ ...unbooted, envState: 'stopped' }, ddevProject)).toBe(false)
  })

  it('before the first boot the project detection decides', () => {
    expect(hasPreviewTarget(unbooted, ddevProject)).toBe(true)
    expect(hasPreviewTarget(unbooted, generatedProject)).toBe(false)
    expect(hasPreviewTarget(unbooted, { ...generatedProject, previewPort: 3000 })).toBe(true)
  })

  it('projects resolved before detection existed were all ddev projects', () => {
    expect(hasPreviewTarget(unbooted, { ddevEnv: { ...ddevProject.ddevEnv, source: undefined }, previewPort: null })).toBe(true)
    expect(hasPreviewTarget(unbooted, { ddevEnv: null, previewPort: null })).toBe(true)
  })
})
