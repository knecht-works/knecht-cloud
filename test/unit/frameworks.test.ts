import { describe, expect, it } from 'vitest'
import { frameworkUrlMode } from '../../shared/utils/frameworks'

describe('frameworkUrlMode', () => {
  it('starts a CMS that keeps its base URL in the database in rewrite mode', () => {
    for (const id of ['wordpress', 'shopware6', 'magento2', 'magento']) expect(frameworkUrlMode(id)).toBe('rewrite')
  })

  it('starts everything else, and an undetected framework, in env mode', () => {
    for (const id of ['craftcms', 'drupal', 'laravel', 'nuxt', 'something-else', null, undefined]) expect(frameworkUrlMode(id)).toBe('env')
  })
})
