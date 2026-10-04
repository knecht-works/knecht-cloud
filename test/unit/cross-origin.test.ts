import { describe, expect, it } from 'vitest'
import { withoutDashboardCookie } from '../../server/utils/preview-proxy'
import { isForeignOrigin } from '../../server/utils/origin'

describe('isForeignOrigin', () => {
  it('accepts the dashboard itself and requests without an Origin', () => {
    expect(isForeignOrigin('https://knecht.example', 'knecht.example')).toBe(false)
    expect(isForeignOrigin('http://lvh.me:3333', 'lvh.me:3333')).toBe(false)
    expect(isForeignOrigin(undefined, 'knecht.example')).toBe(false)
  })

  it('refuses a preview of the same site, another site and an opaque origin', () => {
    expect(isForeignOrigin('https://115.preview.knecht.example', 'knecht.example')).toBe(true)
    expect(isForeignOrigin('https://evil.example', 'knecht.example')).toBe(true)
    expect(isForeignOrigin('null', 'knecht.example')).toBe(true)
  })
})

describe('withoutDashboardCookie', () => {
  it('drops only the dashboard session', () => {
    expect(withoutDashboardCookie('CraftSessionId=a; nuxt-session=secret; theme=dark')).toBe('CraftSessionId=a; theme=dark')
    expect(withoutDashboardCookie('nuxt-session=secret')).toBeUndefined()
    expect(withoutDashboardCookie(undefined)).toBeUndefined()
  })
})
