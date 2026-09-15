import { createHmac, timingSafeEqual } from 'node:crypto'

// GitHub and Jira both sign the raw body as `sha256=<hex>` with a shared secret.
export function verifySha256Signature(raw: string, secret: string, provided: string): boolean {
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`)
  const given = Buffer.from(provided)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
