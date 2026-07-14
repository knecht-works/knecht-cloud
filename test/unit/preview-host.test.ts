import { describe, expect, it } from 'vitest'
import { isPreviewHost, parsePreviewHost, previewHostname, previewLabel, stripPreviewPrefix } from '../../shared/utils/preview-host'

describe('preview host scheme', () => {
  it('builds and parses primary and labeled origins symmetrically', () => {
    const primary = previewHostname(42, 'lvh.me:3333')
    expect(primary).toBe('42.preview.lvh.me:3333')
    expect(parsePreviewHost('42.preview.lvh.me')).toEqual({ runId: 42, label: undefined })

    const labeled = previewHostname(42, 'example.com', 'alpha-test')
    expect(labeled).toBe('alpha-test--42.preview.example.com')
    expect(parsePreviewHost('alpha-test--42.preview.example.com')).toEqual({ runId: 42, label: 'alpha-test' })
  })

  it('does not mistake dashboard or project hosts for preview hosts', () => {
    expect(isPreviewHost('knecht.example.com')).toBe(false)
    expect(isPreviewHost('preview.example.com')).toBe(false)
    expect(parsePreviewHost('demo.ddev.site')).toBeNull()
  })

  it('recovers the dashboard host from a preview host, keeping the port', () => {
    expect(stripPreviewPrefix('alpha--42.preview.lvh.me:3333')).toBe('lvh.me:3333')
  })

  it('derives labels from ddev hostnames', () => {
    expect(previewLabel('demo.ddev.site')).toBe('demo')
    expect(previewLabel('knaus.kta.ddev.site')).toBe('knaus-kta')
    expect(previewLabel('www.example.com')).toBe('www-example-com')
  })
})
