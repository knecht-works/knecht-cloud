import { chromium } from 'playwright'
import fs from 'node:fs'
const jar = fs.readFileSync(new URL('./jar.txt', import.meta.url), 'utf8').split('\n').filter(l => l.includes('\t'))
const cookies = jar.map(l => { const p = l.replace(/^#HttpOnly_/, '').split('\t'); return { name: p[5], value: p[6], domain: '.' + p[0].replace(/^\./, ''), path: p[2], httpOnly: l.startsWith('#HttpOnly_') } })
const HIDE = 'aside a[href="/system"]{display:none!important}'
export async function shoot(name, { url, w = 1440, h = 900, dpr = 2, act }) {
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: 'dark' })
  await ctx.addCookies(cookies)
  const page = await ctx.newPage()
  page.setDefaultTimeout(5000)
  await page.goto('http://lvh.me:3333' + url, { waitUntil: 'load', timeout: 20000 })
  await page.addStyleTag({ content: HIDE })
  await page.waitForTimeout(2500)
  if (act) await act(page).catch(async e => { await page.screenshot({ path: new URL(`./new/${name}-err.png`, import.meta.url).pathname }); throw e })
  await page.evaluate(() => document.activeElement?.blur())
  const d = page.getByRole('dialog')
  if (await d.count()) await d.getByText(/^(New|Edit) trigger$/).click().catch(() => {})
  await page.mouse.move(0, 0)
  await page.waitForTimeout(600)
  await page.screenshot({ path: new URL(`./new/${name}.png`, import.meta.url).pathname })
  await browser.close()
}
const only = process.argv[2]
const { default: shots } = await import(process.argv[3] || './shots.mjs')
for (const [name, spec] of Object.entries(shots)) {
  if (only && only !== 'all' && !only.split(',').includes(name)) continue
  try { await shoot(name, spec); console.log('ok', name) } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]) }
}
