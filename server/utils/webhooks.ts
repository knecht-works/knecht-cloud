import { and, eq } from 'drizzle-orm'
import { createError, getHeader, readRawBody, type H3Event } from 'h3'
import { db, schema } from '../db'
import type { Integration } from '../integrations'
import { handleMention } from './mentions'
import { syncObjectStatus } from './sessions'
import { fireTrigger } from './triggers'

// No session gate: the integration authenticates the delivery with its signature over the raw body.
export async function handleWebhook(integration: Integration, event: H3Event) {
  if (!integration.isConfigured()) {
    throw createError({ statusCode: 404, statusMessage: `${integration.id} webhook not configured` })
  }

  const raw = (await readRawBody(event, 'utf8')) ?? ''
  const header = (name: string) => getHeader(event, name)
  const record = integration.webhook.record ?? (() => {})
  if (!raw.trim()) {
    record({ ok: false, reason: 'empty-body' })
    throw createError({ statusCode: 400, statusMessage: 'Empty body' })
  }
  if (!integration.webhook.verify(raw, header)) {
    record({ ok: false, reason: 'signature' })
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  const delivery = await integration.webhook.parse(raw, header)
  if (!delivery) {
    record({ ok: false, reason: 'no-project' })
    console.log(`${integration.id} webhook: no matching project`)
    return { ok: true, skipped: 'no matching project' }
  }
  record({ ok: true, summary: delivery.summary })
  const { project } = delivery

  let outcome: string | undefined
  if (delivery.comment) {
    outcome = await handleMention(integration, project, delivery.comment)
    console.log(`${integration.id} webhook: ${delivery.summary} from ${project.fullName} → ${outcome}`)
  }

  if (delivery.statusChange) {
    syncObjectStatus(project.id, delivery.statusChange.object, delivery.statusChange.status)
  }

  const runIds: number[] = []
  if (delivery.event) {
    const candidates = db
      .select()
      .from(schema.triggers)
      .where(and(eq(schema.triggers.source, integration.id), eq(schema.triggers.active, true)))
      .all()
    for (const trigger of candidates) {
      if (!trigger.projectIds.includes(project.id)) continue
      const match = integration.webhook.match(trigger, delivery)
      if (!match) continue
      runIds.push(...fireTrigger(trigger, {
        projectIds: [project.id],
        branch: match.branch,
        inputs: match.inputs,
        object: match.object,
      }))
    }
    console.log(`${integration.id} webhook: ${delivery.summary} from ${project.fullName} → ${runIds.length ? `run(s) ${runIds.join(', ')}` : 'no trigger matched'}`)
  }

  return { ok: true, ...(outcome ? { outcome } : {}), runIds }
}
