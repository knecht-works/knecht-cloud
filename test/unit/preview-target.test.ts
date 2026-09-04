import { describe, expect, it } from 'vitest'
import { hasPreviewTarget } from '../../server/utils/preview-target'

const env = { webserver: 'nginx-fpm', phpVersion: null, dbType: null, dbVersion: null, nodeVersion: null, packageManager: null }
const ddevProject = { ddevEnv: { ...env, detected: { source: 'ddev' as const, fields: {}, warnings: [] } }, devServer: null, previewPort: null }
const generatedProject = { ddevEnv: { ...env, detected: { source: 'generated' as const, fields: {}, warnings: [] } }, devServer: null, previewPort: null }
const unbooted = { previewHosts: [], previewPort: null, envState: 'down' as const }

describe('hasPreviewTarget', () => {
  it('a booted session decides by its pinned hosts or port', () => {
    expect(hasPreviewTarget({ ...unbooted, previewHosts: ['demo.ddev.site'], envState: 'up' }, generatedProject)).toBe(true)
    expect(hasPreviewTarget({ ...unbooted, previewPort: 3000, envState: 'up' }, generatedProject)).toBe(true)
    expect(hasPreviewTarget({ ...unbooted, envState: 'up' }, generatedProject)).toBe(false)
    expect(hasPreviewTarget({ ...unbooted, envState: 'stopped' }, generatedProject)).toBe(false)
    // A configured dev server counts only through the pinned port once booted.
    expect(hasPreviewTarget({ ...unbooted, envState: 'up' }, { ...generatedProject, devServer: 'npm run dev', previewPort: 3000 })).toBe(false)
  })

  it('a booted ddev project serves its site even with no pinned hosts (nameless or unparsable config)', () => {
    expect(hasPreviewTarget({ ...unbooted, envState: 'up' }, ddevProject)).toBe(true)
    expect(hasPreviewTarget({ ...unbooted, envState: 'stopped' }, ddevProject)).toBe(true)
  })

  it('before the first boot the project detection decides', () => {
    expect(hasPreviewTarget(unbooted, ddevProject)).toBe(true)
    expect(hasPreviewTarget(unbooted, generatedProject)).toBe(false)
    expect(hasPreviewTarget(unbooted, { ...generatedProject, devServer: 'npm run dev', previewPort: 3000 })).toBe(true)
    // A port alone is not a dev server (the boot writes no daemon for it).
    expect(hasPreviewTarget(unbooted, { ...generatedProject, previewPort: 3000 })).toBe(false)
  })

  it('projects resolved before detection existed were all ddev projects', () => {
    expect(hasPreviewTarget(unbooted, { ddevEnv: env, devServer: null, previewPort: null })).toBe(true)
    expect(hasPreviewTarget(unbooted, { ddevEnv: null, devServer: null, previewPort: null })).toBe(true)
  })
})
