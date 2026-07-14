import { defineStep } from './define'

export const linkCheckStep = defineStep({
  type: 'link-check',
  label: 'Link checker',
  hint: 'Check sitemap pages or a URL list for HTTP errors',
  kind: 'det',
  icon: 'i-lucide-link',
  group: 'Test',
  fields: [
    { key: 'sitemap', label: 'Sitemap URL', input: 'text', vars: true, placeholder: 'https://example.com/sitemap.xml' },
    { key: 'urls', label: 'URLs (instead of the sitemap): one per line, or an array reference', input: 'textarea', rows: 2, vars: true, placeholder: '{{ steps.s2.brokenUrls }}' },
  ],
  outputs: [
    { path: 'checked', hint: 'Number of pages checked' },
    { path: 'broken', hint: 'Number of broken pages' },
    { path: 'brokenUrls', hint: 'The broken pages, as [{ url, status }]' },
  ],
  make: () => ({ type: 'link-check', sitemap: '', continueOnError: true }),
  meta: step => ({ detail: step.sitemap || step.urls || '' }),
})
