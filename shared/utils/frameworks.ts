export interface Framework {
  id: string
  label: string
  color?: string
  composer?: string[]
  npm?: string[]
}

// Detection takes the first entry whose package the repo requires, so a CMS sits
// above the framework it is built on. Entries without packages only label a ddev type.
export const FRAMEWORKS: Framework[] = [
  { id: 'craftcms', label: 'Craft CMS', color: '#7aa8d8', composer: ['craftcms/cms'] },
  { id: 'statamic', label: 'Statamic', color: 'var(--accent-violet)', composer: ['statamic/cms'] },
  { id: 'kirby', label: 'Kirby', color: 'var(--accent-mint)', composer: ['getkirby/cms'] },
  { id: 'typo3', label: 'TYPO3', color: 'var(--accent-orange)', composer: ['typo3/cms-core'] },
  { id: 'shopware6', label: 'Shopware', color: 'var(--primary)', composer: ['shopware/core'] },
  { id: 'magento2', label: 'Magento', color: 'var(--accent-orange)', composer: ['magento/product-community-edition', 'magento/framework'] },
  { id: 'drupal', label: 'Drupal', color: '#7aa8d8', composer: ['drupal/core', 'drupal/core-recommended'] },
  { id: 'wordpress', label: 'WordPress', color: 'var(--accent-violet)', composer: ['roots/wordpress', 'johnpbloch/wordpress-core'] },
  { id: 'silverstripe', label: 'SilverStripe', color: '#7aa8d8', composer: ['silverstripe/framework'] },
  { id: 'laravel', label: 'Laravel', color: 'var(--accent-clay)', composer: ['laravel/framework'] },
  { id: 'nuxt', label: 'Nuxt', color: 'var(--primary)', npm: ['nuxt'] },
  { id: 'next', label: 'Next.js', color: 'var(--accent-ink)', npm: ['next'] },
  { id: 'vue', label: 'Vue', color: 'var(--accent-mint)', npm: ['vue'] },
  { id: 'magento', label: 'Magento', color: 'var(--accent-orange)' },
  { id: 'backdrop', label: 'Backdrop', color: '#7aa8d8' },
  { id: 'php', label: 'PHP' },
]
