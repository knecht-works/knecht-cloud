import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BASE_URL, expectJson, login, type E2eClient } from '../e2e/client'

let browser: Browser
let owner: E2eClient

function devLogin({ stale = false } = {}): string {
  return `${BASE_URL}/_test/login?secret=${encodeURIComponent(process.env.KNECHT_TEST_AUTH!)}${stale ? '&stale=1' : ''}`
}

// A session past its elevation, whose "Confirm with GitHub" popup comes back
// confirmed: the OAuth round trip is replaced by a fresh dev login.
async function staleOwnerPage(): Promise<{ context: BrowserContext, page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL })
  await context.route(url => url.pathname === '/auth/github' && url.searchParams.has('elevate'), async (route) => {
    const returnTo = new URL(route.request().url()).searchParams.get('return')
    const fresh = await fetch(devLogin())
    await route.fulfill({ status: 302, headers: { 'location': `${returnTo}?reauth=done`, 'set-cookie': fresh.headers.getSetCookie().join('\n') } })
  })
  const page = await context.newPage()
  await page.goto(devLogin({ stale: true }))
  return { context, page }
}

async function open(page: Page, path: string) {
  await page.goto(path)
  // Vue sets __vue_app__ once the app is mounted, so clicks before that would hit inert SSR markup.
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__)
}

beforeAll(async () => {
  owner = await login()
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
})

describe('confirming with GitHub', () => {
  it('creates the invite link the confirmation interrupted and shows it', async () => {
    const before = (await expectJson<{ id: number }[]>(await owner.fetch('/api/invites'))).map(i => i.id)
    const { context, page } = await staleOwnerPage()
    try {
      await open(page, '/settings')
      await page.getByText('Create invite link', { exact: true }).click()
      await page.getByRole('button', { name: 'Confirm with GitHub' }).click()

      const dialog = page.getByRole('dialog', { name: 'Invite link created' })
      await expect.poll(() => dialog.getByRole('textbox').inputValue(), { timeout: 15_000 }).toMatch(/\/join\/\S+$/)
    }
    finally {
      await context.close()
      for (const invite of await expectJson<{ id: number }[]>(await owner.fetch('/api/invites'))) {
        if (!before.includes(invite.id)) await owner.fetch(`/api/invites/${invite.id}`, { method: 'DELETE' })
      }
    }
  })

  it('saves the setting the confirmation interrupted', async () => {
    const { sshTarget } = await expectJson<{ sshTarget: string | null }>(await owner.fetch('/api/settings'))
    const target = `e2e-${Date.now()}@example.com`
    const { context, page } = await staleOwnerPage()
    try {
      // The client fetches the settings once more after hydration and resets the field, so type after that.
      const loaded = page.waitForResponse(res => new URL(res.url()).pathname === '/api/settings', { timeout: 10_000 }).catch(() => {})
      await open(page, '/settings/advanced')
      await loaded
      await page.locator('div.grid').filter({ has: page.getByText('SSH address', { exact: true }) }).last().getByRole('textbox').fill(target)
      await page.getByRole('button', { name: 'Confirm with GitHub' }).click()

      await expect.poll(async () => (await expectJson<{ sshTarget: string | null }>(await owner.fetch('/api/settings'))).sshTarget, { timeout: 15_000 }).toBe(target)
    }
    finally {
      await context.close()
      await owner.fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sshTarget }) })
    }
  })
})
