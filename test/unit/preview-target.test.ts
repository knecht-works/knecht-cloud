import { describe, expect, it } from 'vitest'
import { hasPreviewTarget } from '../../server/utils/preview-target'

const env = { webserver: 'nginx-fpm', phpVersion: null, dbType: null, dbVersion: null, nodeVersion: null, packageManager: null }
const ddevProject = { ddevEnv: { ...env, detected: { source: 'ddev' as const, fields: {}, warnings: [] } }, previewPort: null }
const generatedProject = { ddevEnv: { ...env, detected: { source: 'generated' as const, fields: {}, warnings: [] } }, previewPort: null }
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
    expect(hasPreviewTarget(unbooted, { ddevEnv: env, previewPort: null })).toBe(true)
    expect(hasPreviewTarget(unbooted, { ddevEnv: null, previewPort: null })).toBe(true)
  })
})
