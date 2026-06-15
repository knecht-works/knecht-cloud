import { createHmac, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { fireTrigger } from '../../../utils/triggers'

// POST /api/triggers/:id/webhook → GitHub webhook receiver. Exempt from the
// session gate (see server/middleware/auth.ts) — GitHub authenticates instead via
// the HMAC signature over the raw body, checked against the trigger's generated
// secret. Fires the trigger when the delivered event matches. This is the "needs
// setup" path: it only works once the webhook + secret are configured on GitHub
// and Knecht is reachable at a public URL.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid trigger id' })
  }

  const row = db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()
  if (!row || row.source !== 'github' || !row.webhookSecret) {
    throw createError({ statusCode: 404, statusMessage: 'Trigger not found' })
  }

  const raw = (await readRawBody(event, 'utf8')) ?? ''
  const expected = `sha256=${createHmac('sha256', row.webhookSecret).update(raw).digest('hex')}`
  const provided = getHeader(event, 'x-hub-signature-256') ?? ''
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  // Ignore deliveries for events this trigger doesn't listen for (e.g. the
  // one-off 'ping' GitHub sends when the webhook is first added).
  const delivered = getHeader(event, 'x-github-event')
  if (delivered !== (row.webhookEvent ?? 'push')) {
    return { ok: true, skipped: delivered }
  }

  if (!row.active) return { ok: true, skipped: 'inactive' }

  const runIds = fireTrigger(row)
  return { ok: true, runIds }
})
