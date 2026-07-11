import { z } from 'zod'
import { tryParseJson } from '../../utils/json'
import { defineAction, ActionError } from './types'

// A website test: request every page of a sitemap (or of an explicit URL
// list) and report the ones answering with an HTTP error (or not at all).
// Runs host-side like the http action; a sitemap index is followed one level
// deep (the format nests no further).
const FETCH_TIMEOUT_MS = 15_000
const CONCURRENCY = 5
// Keeps the outputs bag well under the runner's 64 KB cap even when a site is
// thoroughly broken; the run log still lists every failure.
const MAX_BROKEN_LISTED = 200

export const linkCheckAction = defineAction({
  type: 'link-check',
  params: {
    // Templated ({{ }}), so URL-validity is a runtime concern, not a save-time
    // one. One of sitemap/urls must be given; the runtime checks (either may
    // legitimately be blank when the other is a template).
    sitemap: z.string().optional(),
    urls: z.string().optional(),
    failOnBroken: z.boolean().optional(),
  },
  // A single {{ ref }} in urls passes the referenced array raw (a previous
  // link-check's brokenUrls flows through without a stringify round-trip).
  rawParams: ['urls'],
  async run(step, rt) {
    let urls = listedUrls(step.urls as unknown)
    if (urls) {
      rt.log(`\n▶ link-check: ${urls.length} listed URL(s)\n`)
    }
    else if (step.sitemap?.trim()) {
      rt.log(`\n▶ link-check: ${step.sitemap}\n`)
      urls = await collectPageUrls(step.sitemap, rt.signal, rt.log)
      if (!urls.length) {
        throw new ActionError(`No page URLs found in ${step.sitemap}`, { checked: 0, broken: 0, brokenUrls: [] })
      }
    }
    else {
      throw new ActionError('link-check needs a sitemap URL or a list of URLs')
    }
    if (!urls.length) {
      rt.log('\n▶ link-check: no URLs to check\n')
      return { checked: 0, broken: 0, brokenUrls: [] }
    }
    rt.log(`Checking ${urls.length} pages…\n`)

    const broken: { url: string, status: number | string }[] = []
    let next = 0
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, async () => {
      while (next < urls.length) {
        if (rt.signal.aborted) return
        const url = urls[next++]!
        const status = await checkPage(url, rt.signal)
        if (typeof status !== 'number' || status >= 400) {
          broken.push({ url, status })
          rt.log(`✗ ${status} ${url}\n`)
        }
      }
    }))
    rt.signal.throwIfAborted()

    const outputs = {
      checked: urls.length,
      broken: broken.length,
      brokenUrls: broken.slice(0, MAX_BROKEN_LISTED),
    }
    if (broken.length) {
      const message = `${broken.length} of ${urls.length} pages broken`
      if (step.failOnBroken ?? true) throw new ActionError(message, outputs)
      rt.log(`${message} (continuing: fail on broken pages is off)\n`)
    }
    else {
      rt.log(`✓ all ${urls.length} pages OK\n`)
    }
    return outputs
  },
})

// The urls param resolved to a deduplicated list. Accepts newline-separated
// text, a JSON array string, or a raw array (strings or { url } objects).
// null when the param is unset/blank, so the sitemap path takes over; an
// explicitly empty list stays [] (a re-check of zero broken pages passes).
function listedUrls(value: unknown): string[] | null {
  if (value == null) return null
  let list: unknown = value
  if (typeof list === 'string') {
    const text = list.trim()
    if (!text) return null
    list = tryParseJson(text) ?? text.split('\n')
  }
  const entries = Array.isArray(list) ? list : [list]
  const urls = entries.map((entry) => {
    if (typeof entry === 'string') return entry.trim()
    if (entry && typeof entry === 'object' && typeof (entry as { url?: unknown }).url === 'string') {
      return (entry as { url: string }).url
    }
    return ''
  }).filter(Boolean)
  return [...new Set(urls)]
}

// Every page URL the sitemap lists, deduplicated; for a sitemap index, the
// union of its sub-sitemaps' pages.
async function collectPageUrls(sitemapUrl: string, signal: AbortSignal, log: (text: string) => void): Promise<string[]> {
  const xml = await fetchSitemap(sitemapUrl, signal)
  if (!/<sitemapindex[\s>]/i.test(xml)) return [...new Set(extractLocs(xml))]

  const subs = extractLocs(xml)
  log(`Sitemap index with ${subs.length} sitemaps\n`)
  const urls = new Set<string>()
  for (const sub of subs) {
    for (const url of extractLocs(await fetchSitemap(sub, signal))) urls.add(url)
  }
  return [...urls]
}

async function fetchSitemap(url: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) })
  if (!res.ok) throw new ActionError(`HTTP ${res.status} fetching sitemap ${url}`)
  return await res.text()
}

// The final status after redirects, or the failure message when the request
// itself failed (DNS, TLS, timeout). The body is never downloaded.
async function checkPage(url: string, signal: AbortSignal): Promise<number | string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) })
    await res.body?.cancel()
    return res.status
  }
  catch (err) {
    if (signal.aborted) return 'cancelled'
    return err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err)
  }
}

// <loc> contents; sitemaps are flat enough that a scan beats an XML dependency.
function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)]
    .map(m => decodeXmlEntities(m[1]!))
}

function decodeXmlEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' }
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => named[name]!)
}
