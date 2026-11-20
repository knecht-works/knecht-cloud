import { describe, expect, it } from 'vitest'
import { credentialDevServerTags, devServerCorsOrigin, devServerLabel, devServerOrigin, devServerUseNote, looksLikeDevServerLabel, pointTagsAtDevServer, verifyDevServerLabel } from '#server/utils/dev-origin'
import { parsePreviewHost, previewHostname, previewLabel } from '#shared/utils/preview-host'

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

describe('pointTagsAtDevServer', () => {
  const dev = { port: 3000, hosts: ['rotax.ddev.site', 'cp.rotax.ddev.site'] }
  const target = 'https://dev--7.preview.knecht.test'
  const point = (html: string) => pointTagsAtDevServer(html, dev, target)

  it('points script and link URLs on the local dev server at the dev origin', () => {
    expect(point(`<script type="module" src="https://localhost:3000/assets/js/app.ts"></script>`))
      .toBe(`<script type="module" src="${target}/assets/js/app.ts"></script>`)
    expect(point(`<script type="module" src="http://0.0.0.0:3000/@vite/client"></script>`))
      .toBe(`<script type="module" src="${target}/@vite/client"></script>`)
    expect(point(`<link rel='stylesheet' href='//127.0.0.1:3000/src/app.css?v=1&amp;x=2'>`))
      .toBe(`<link rel='stylesheet' href='${target}/src/app.css?v=1&amp;x=2'>`)
    expect(point(`<script type=module src=https://[::1]:3000/app.ts></script>`))
      .toBe(`<script type=module src=${target}/app.ts></script>`)
    expect(point(`<link rel="modulepreload" href="https://CP.rotax.ddev.site:3000/src/app.js">`))
      .toBe(`<link rel="modulepreload" href="${target}/src/app.js">`)
  })

  it('leaves URLs alone that are not the dev server', () => {
    const untouched = [
      `<script type="module" src="https://rotax.ddev.site/dist/app.js"></script>`,
      `<script type="module" src="https://localhost:5173/app.ts"></script>`,
      `<script type="module" src="https://other.ddev.site:3000/app.ts"></script>`,
      `<script type="module" src="/assets/js/app.ts"></script>`,
      `<script type="module" data-src="https://localhost:3000/app.ts"></script>`,
      `<a href="https://localhost:3000/">dev</a>`,
      `<img src="https://localhost:3000/logo.png">`,
    ]
    for (const html of untouched) expect(point(html)).toBe(html)
  })
})

describe('devServerUseNote', () => {
  const dev = { port: 3000, hosts: ['rotax.ddev.site'] }
  const devHost = 'dev--7.preview.knecht.test'
  const note = (html: string) => devServerUseNote(html, dev, devHost)

  it('says nothing when the page loads from the dev origin or from Vite behind the site', () => {
    expect(note(`<script type="module" src="https://${devHost}/@vite/client"></script>`)).toBeNull()
    expect(note(`<script type="module" src="/@vite/client"></script>`)).toBeNull()
  })

  it('names a local dev server URL, which previews rewrite', () => {
    expect(note(`<script type="module" src="https://localhost:3000/assets/js/app.ts"></script>`))
      .toContain('https://localhost:3000/assets/js/app.ts')
  })

  it('warns about a loopback URL on another port than the dev server', () => {
    const line = note(`<script type="module" src="http://localhost:5173/src/app.js"></script>`)
    expect(line).toContain('http://localhost:5173/src/app.js')
    expect(line).toContain('port 3000')
  })

  it('warns when the page loads nothing from the dev server', () => {
    expect(note(`<script type="module" src="/dist/assets/app-abc.js"></script>`)).toContain('loads nothing from it')
  })
})
