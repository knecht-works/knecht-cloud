import { describe, expect, it } from 'vitest'
import { createSSRApp, h, Suspense } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { defineComarkComponent } from '@comark/vue'

Object.assign(globalThis, { defineComarkComponent })
const ChatComark = (await import('../../app/components/chat/Comark')).default

function render(markdown: string) {
  return renderToString(createSSRApp({ render: () => h(Suspense, null, { default: () => h(ChatComark, { markdown }) }) }))
}

describe('ChatComark', () => {
  it.each([
    '<img src=x onerror="alert(1)">',
    '<a href="javascript:alert(1)">x</a>',
    '<script>alert(1)</script>',
    '[click](javascript:alert(1))',
  ])('renders %s from an agent as inert text', async (markdown) => {
    const out = await render(markdown)
    expect(out).not.toMatch(/<(img|script)\b|<[^>]*onerror=|href="javascript:/)
  })

  it('still renders markdown', async () => {
    expect(await render('[ok](https://example.com) **bold**')).toContain('<a href="https://example.com">ok</a> <strong>bold</strong>')
  })
})
