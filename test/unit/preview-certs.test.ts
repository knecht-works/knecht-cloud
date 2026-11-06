import { afterEach, describe, expect, it, vi } from 'vitest'
import { previewCertOrigins } from '../../server/utils/preview-certs'
import { devServerLabel } from '../../server/utils/dev-origin'

afterEach(() => vi.unstubAllEnvs())

describe('previewCertOrigins', () => {
  it('lists the primary host, every further ddev host and the dev origin', () => {
    vi.stubEnv('KNECHT_BASE_URL', 'https://knecht.test')
    expect(previewCertOrigins(7, ['demo.ddev.site', 'api.demo.ddev.site'], true)).toEqual([
      'https://7.preview.knecht.test',
      'https://api-demo--7.preview.knecht.test',
      `https://${devServerLabel(7)}--7.preview.knecht.test`,
    ])
    expect(previewCertOrigins(7, [], false)).toEqual(['https://7.preview.knecht.test'])
  })

  it('warms nothing without TLS in front', () => {
    vi.stubEnv('KNECHT_BASE_URL', 'http://knecht.test')
    expect(previewCertOrigins(7, ['demo.ddev.site'], true)).toEqual([])
  })
})
