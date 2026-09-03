import { describe, expect, it } from 'vitest'
import { devServerLabel, devServerOrigin, looksLikeDevServerLabel, verifyDevServerLabel } from '../../server/utils/dev-origin'
import { parsePreviewHost, previewHostname, previewLabel } from '../../shared/utils/preview-host'

describe('dev origin label', () => {
  it('is a per-session token that fits a DNS label and survives the preview host round trip', () => {
    const label = devServerLabel(7)
    expect(label).toMatch(/^dev-[0-9a-f]{32}$/)
    expect(label.length).toBeLessThan(64)
    expect(devServerLabel(7)).toBe(label)
    expect(devServerLabel(8)).not.toBe(label)
    expect(parsePreviewHost(previewHostname(7, 'knecht.test', label))).toEqual({ sessionId: 7, label })
    expect(devServerOrigin(7)).toBe(`http://${label}--7.preview.knecht.test`)
  })

  it('verifies only its own session\'s label', () => {
    const label = devServerLabel(7)
    expect(verifyDevServerLabel(7, label)).toBe(true)
    expect(verifyDevServerLabel(8, label)).toBe(false)
    expect(verifyDevServerLabel(7, 'dev-' + '0'.repeat(32))).toBe(false)
    expect(verifyDevServerLabel(7, undefined)).toBe(false)
    expect(verifyDevServerLabel(7, 'alpha')).toBe(false)
  })

  it('tells a dev label apart from a project hostname\'s label before verifying it', () => {
    expect(looksLikeDevServerLabel(devServerLabel(7))).toBe(true)
    expect(looksLikeDevServerLabel('dev-' + '0'.repeat(32))).toBe(true)
    // A repo's own staging hostnames label as dev-… too: they are hostnames.
    expect(looksLikeDevServerLabel(previewLabel('dev.example.com'))).toBe(false)
    expect(looksLikeDevServerLabel(previewLabel('dev-api.ddev.site'))).toBe(false)
    expect(looksLikeDevServerLabel('dev-0000')).toBe(false)
    expect(looksLikeDevServerLabel('dev')).toBe(false)
    expect(looksLikeDevServerLabel('alpha')).toBe(false)
    expect(looksLikeDevServerLabel(undefined)).toBe(false)
  })
})
