import { describe, expect, it } from 'vitest'
import { rewriteModeRequestHeaders, withoutSecureFlag } from '../../server/utils/preview-proxy'

const mappings = [{ host: 'site.ddev.site', previewHost: '7.preview.lvh.me:3333' }]

describe('rewriteModeRequestHeaders', () => {
  it('addresses the site by its own host and asks for an uncompressed body', () => {
    const headers = rewriteModeRequestHeaders({ 'host': '7.preview.lvh.me:3333', 'accept-encoding': 'gzip' }, 'site.ddev.site', mappings, 'http:')
    expect(headers.host).toBe('site.ddev.site')
    expect(headers['accept-encoding']).toBe('identity')
  })

  it('tells the site the request was https, with or without a TLS proxy in front', () => {
    expect(rewriteModeRequestHeaders({}, 'site.ddev.site', mappings, 'http:')['x-forwarded-proto']).toBe('https')
    expect(rewriteModeRequestHeaders({ 'x-forwarded-proto': 'http' }, 'site.ddev.site', mappings, 'http:')['x-forwarded-proto']).toBe('https')
  })

  it('maps Origin and Referer from the preview origin to the site host', () => {
    const headers = rewriteModeRequestHeaders({
      origin: 'http://7.preview.lvh.me:3333',
      referer: 'http://7.preview.lvh.me:3333/wp/wp-login.php',
    }, 'site.ddev.site', mappings, 'http:')
    expect(headers.origin).toBe('http://site.ddev.site')
    expect(headers.referer).toBe('http://site.ddev.site/wp/wp-login.php')
  })
})

describe('withoutSecureFlag', () => {
  it('drops the Secure attribute and keeps the rest of the cookie', () => {
    expect(withoutSecureFlag('wordpress_test_cookie=WP%20Cookie%20check; path=/; secure; HttpOnly')).toBe('wordpress_test_cookie=WP%20Cookie%20check; path=/; HttpOnly')
    expect(withoutSecureFlag('sid=1; Path=/; Secure')).toBe('sid=1; Path=/')
  })

  it('leaves a cookie alone whose value merely contains the word', () => {
    expect(withoutSecureFlag('mode=secure; path=/')).toBe('mode=secure; path=/')
  })
})
