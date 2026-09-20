import { createHmac, timingSafeEqual } from 'node:crypto'

// Every tool signs the raw body with the shared secret. GitHub and Jira send `sha256=<hex>`, others the bare hex (prefix '').
export function verifySha256Signature(raw: string, secret: string, provided: string, prefix = 'sha256='): boolean {
  const expected = Buffer.from(`${prefix}${createHmac('sha256', secret).update(raw).digest('hex')}`)
  const given = Buffer.from(provided)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
