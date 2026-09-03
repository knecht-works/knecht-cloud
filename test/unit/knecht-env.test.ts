import { describe, expect, it, vi } from 'vitest'
import { devServerLabel } from '../../server/utils/dev-origin'
import { sessionEnv } from '../../server/utils/knecht-env'

describe('sessionEnv', () => {
  it('names the primary preview origin and one origin per additional host', () => {
    expect(sessionEnv(7, ['demo.ddev.site', 'alpha.ddev.site', 'www.example.com'])).toEqual({
      KNECHT_PREVIEW_URL: 'http://7.preview.knecht.test',
      KNECHT_URL_ALPHA: 'http://alpha--7.preview.knecht.test',
      KNECHT_URL_WWW_EXAMPLE_COM: 'http://www-example-com--7.preview.knecht.test',
    })
    expect(sessionEnv(7, [])).toEqual({ KNECHT_PREVIEW_URL: 'http://7.preview.knecht.test' })
  })

  it('names where the browser reaches a dev server: its own origin next to ddev hostnames, the preview itself otherwise', () => {
    expect(sessionEnv(7, ['demo.ddev.site'], true)).toEqual({
      KNECHT_PREVIEW_URL: 'http://7.preview.knecht.test',
      KNECHT_DEV_SERVER_URL: `http://${devServerLabel(7)}--7.preview.knecht.test`,
    })
    expect(sessionEnv(7, [], true)).toEqual({
      KNECHT_PREVIEW_URL: 'http://7.preview.knecht.test',
      KNECHT_DEV_SERVER_URL: 'http://7.preview.knecht.test',
    })
  })

  it('is empty without a base origin to point at', () => {
    vi.stubEnv('KNECHT_BASE_URL', '')
    vi.stubEnv('KNECHT_BASE_DOMAIN', '')
    try {
      expect(sessionEnv(7, ['demo.ddev.site'])).toEqual({})
    }
    finally {
      vi.unstubAllEnvs()
    }
  })
})
