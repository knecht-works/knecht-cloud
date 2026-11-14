export const GC_CATEGORIES = [
  { id: 'sessions', label: 'Removed sessions', hint: 'Sandboxes, checkouts and archives whose session is gone.' },
  { id: 'projects', label: 'Removed projects', hint: 'Dump, shared and memory folders of disconnected projects, superseded database dumps and bases.' },
  { id: 'images', label: 'Docker images', hint: 'Images of removed previews and old ddev versions, dangling images and build cache.' },
  { id: 'packageCache', label: 'Package cache', hint: 'npm, Composer and Yarn cache files unused for 30 days.' },
  { id: 'appCache', label: 'Knecht cache', hint: 'Data Knecht caches for itself and loads again when needed.' },
] as const

export type GcCategory = typeof GC_CATEGORIES[number]['id']

export const GC_CATEGORY_IDS = GC_CATEGORIES.map(c => c.id) as [GcCategory, ...GcCategory[]]

export const GC_AUTO_CATEGORIES: readonly GcCategory[] = GC_CATEGORY_IDS.filter(id => id !== 'appCache')
