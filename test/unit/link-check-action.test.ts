import type { ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { linkCheckAction } from '../../server/workflows/actions/link-check'
import { ActionError } from '../../server/workflows/actions'
import type { Step } from '../../shared/utils/workflow'
import { bareRuntime } from '../helpers/action-rt'
import { withServer, type Route } from '../helpers/http-server'

const step = (params: Partial<Extract<Step, { type: 'link-check' }>>): Extract<Step, { type: 'link-check' }> =>
  ({ type: 'link-check', id: 'check', ...params })

const ok: Route = (_req, res) => res.end('ok')
const broken: Route = (_req, res) => {
  res.statusCode = 500
  res.end('boom')
}
const xml = (res: ServerResponse, body: string) => {
  res.setHeader('Content-Type', 'application/xml')
  res.end(body)
}

describe('link-check action: listed URLs', () => {
  it('deduplicates a newline list and skips blank lines', async () => {
    await withServer({ 'GET /a': ok, 'GET /b': ok }, async (origin) => {
      const outputs = await linkCheckAction.run(step({
        urls: `${origin}/a\n\n  ${origin}/b\n${origin}/a\n`,
      }), bareRuntime())
      expect(outputs).toEqual({ checked: 2, broken: 0, brokenUrls: [] })
    })
  })

  it('accepts a raw array of { url } objects (a previous run brokenUrls)', async () => {
    await withServer({ 'GET /a': ok }, async (origin) => {
      const outputs = await linkCheckAction.run(step({
        urls: [{ url: `${origin}/a` }, { url: `${origin}/a` }] as unknown as string,
      }), bareRuntime())
      expect(outputs).toEqual({ checked: 1, broken: 0, brokenUrls: [] })
    })
  })

  it('treats an explicitly empty resolved list as a passing zero-check', async () => {
    const outputs = await linkCheckAction.run(step({ urls: '[]' }), bareRuntime())
    expect(outputs).toEqual({ checked: 0, broken: 0, brokenUrls: [] })
  })

  it('demands a sitemap or urls when both are blank', async () => {
    await expect(linkCheckAction.run(step({ urls: '  ', sitemap: '' }), bareRuntime()))
      .rejects.toThrow(/needs a sitemap URL or a list of URLs/)
  })
})

describe('link-check action: sitemaps', () => {
  it('follows a sitemap index one level and decodes loc entries', async () => {
    // The fixture XML derives the dynamic test origin from the Host header.
    await withServer({
      'GET /sitemap.xml': (req, res) => xml(res, `
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>http://${req.headers.host}/a.xml</loc></sitemap>
          <sitemap><loc>http://${req.headers.host}/b.xml</loc></sitemap>
        </sitemapindex>`),
      'GET /a.xml': (req, res) => xml(res, `
        <urlset><url><loc><![CDATA[ http://${req.headers.host}/page-one ]]></loc></url></urlset>`),
      'GET /b.xml': (req, res) => xml(res, `
        <urlset>
          <url><loc>http://${req.headers.host}/page-two?a=1&amp;b=2</loc></url>
          <url><loc>http://${req.headers.host}/page-one</loc></url>
        </urlset>`),
      'GET /page-one': ok,
      'GET /page-two': ok,
    }, async (origin) => {
      const outputs = await linkCheckAction.run(step({ sitemap: `${origin}/sitemap.xml` }), bareRuntime())
      expect(outputs).toEqual({ checked: 2, broken: 0, brokenUrls: [] })
    })
  })

  it('fails on broken pages by default and reports them when failOnBroken is off', async () => {
    await withServer({ 'GET /a': ok, 'GET /down': broken }, async (origin) => {
      const failing = step({ urls: `${origin}/a\n${origin}/down` })
      const error = await linkCheckAction.run(failing, bareRuntime()).catch(e => e as ActionError)
      expect(error).toBeInstanceOf(ActionError)
      expect((error as ActionError).message).toContain('1 of 2 pages broken')
      expect((error as ActionError).outputs).toMatchObject({
        checked: 2,
        broken: 1,
        brokenUrls: [{ url: `${origin}/down`, status: 500 }],
      })

      const tolerant = await linkCheckAction.run(step({ ...failing, failOnBroken: false }), bareRuntime())
      expect(tolerant).toMatchObject({ checked: 2, broken: 1 })
    })
  })
})
