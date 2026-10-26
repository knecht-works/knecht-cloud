import { describe, expect, it } from 'vitest'
import { credentialDevServerTags, devServerCorsOrigin, devServerLabel, devServerOrigin, looksLikeDevServerLabel, verifyDevServerLabel } from '../../server/utils/dev-origin'
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
    expect(looksLikeDevServerLabel(previewLabel('dev.example.com'))).toBe(false)
    expect(looksLikeDevServerLabel(previewLabel('dev-api.ddev.site'))).toBe(false)
    expect(looksLikeDevServerLabel('dev-0000')).toBe(false)
    expect(looksLikeDevServerLabel('dev')).toBe(false)
    expect(looksLikeDevServerLabel('alpha')).toBe(false)
    expect(looksLikeDevServerLabel(undefined)).toBe(false)
  })
})

describe('dev origin CORS', () => {
  it('allows only the session\'s own preview origins on the same base', () => {
    expect(devServerCorsOrigin('https://7.preview.knecht.test', 7, 'knecht.test')).toBe('https://7.preview.knecht.test')
    expect(devServerCorsOrigin('https://cp--7.preview.knecht.test', 7, 'knecht.test')).toBe('https://cp--7.preview.knecht.test')
    expect(devServerCorsOrigin('https://8.preview.knecht.test', 7, 'knecht.test')).toBeNull()
    expect(devServerCorsOrigin('https://7.preview.evil.test', 7, 'knecht.test')).toBeNull()
    expect(devServerCorsOrigin('https://knecht.test', 7, 'knecht.test')).toBeNull()
    expect(devServerCorsOrigin('null', 7, 'knecht.test')).toBeNull()
    expect(devServerCorsOrigin(undefined, 7, 'knecht.test')).toBeNull()
  })
})

describe('credentialDevServerTags', () => {
  const dev = `${devServerLabel(7)}--7.preview.knecht.test`
  const rewrite = (html: string) => credentialDevServerTags(html, 7, 'knecht.test')

  it('marks module scripts and modulepreloads that load from the dev origin', () => {
    expect(rewrite(`<script type="module" src="https://${dev}/@vite/client"></script>`))
      .toBe(`<script crossorigin="use-credentials" type="module" src="https://${dev}/@vite/client"></script>`)
    expect(rewrite(`<link rel="modulepreload" href="//${dev}/src/app.js">`))
      .toBe(`<link crossorigin="use-credentials" rel="modulepreload" href="//${dev}/src/app.js">`)
  })

  it('puts its crossorigin before an existing one, so the browser uses it', () => {
    expect(rewrite(`<script type=module crossorigin src=https://${dev}/src/app.js></script>`))
      .toBe(`<script crossorigin="use-credentials" type=module crossorigin src=https://${dev}/src/app.js></script>`)
  })

  it('leaves tags alone that do not load modules from the dev origin', () => {
    const untouched = [
      `<script type="module" src="https://cdn.example/lib.js"></script>`,
      `<script type="module" src="/assets/app.js"></script>`,
      `<script type="module" data-src="https://${dev}/x.js">console.log(1)</script>`,
      `<script src="https://${dev}/legacy.js"></script>`,
      `<link rel="stylesheet" href="https://${dev}/src/app.css">`,
      `<link rel="modulepreload" href="https://${devServerLabel(8)}--8.preview.knecht.test/src/app.js">`,
    ]
    for (const html of untouched) expect(rewrite(html)).toBe(html)
  })
})
