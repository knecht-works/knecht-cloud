import { eq } from 'drizzle-orm'
import type { EventHandler } from 'h3'
import { beforeAll, describe, expect, it } from 'vitest'
import { db, schema } from '../../server/db'
import type { Project } from '../../server/db/schema'
import type { Integration } from '../../server/integrations/types'
import { resolveSession, type SessionObject } from '../../server/utils/sessions'
import type { IntegrationId } from '../../shared/utils/integrations'
import type { TriggerConfig } from '../../shared/utils/trigger-form'
import { getSessionRow } from './db'
import { callRoute } from './routes'

export interface WebhookRequest {
  body: string
  headers: Record<string, string>
}

interface DeliveryStatus {
  lastDelivery: { summary: string, at: number } | null
  lastRejected: { reason: string, at: number } | null
}

// The builders run right before their delivery is sent, so they may also stage
// what the mocked vendor API answers (the comment a webhook only references).
export interface WebhookFixture<P extends Project, D> {
  integration: Integration
  handler: EventHandler
  configure(): void
  request(delivery: D, secret?: string): WebhookRequest
  makeProject(): P
  unknownProject(): D
  object(project: P): SessionObject
  created: {
    config: TriggerConfig
    delivery(project: P): D
    run(project: P): object
    session(project: P): object
  }
  labeled: {
    config: TriggerConfig
    gained(project: P): D
    notGained(project: P): D[]
  }
  closed(project: P): D
  reopened(project: P): D
  comment: {
    mention(project: P): D
    fromSelf(project: P): D
    withoutMention(project: P): D
    // Replies Knecht posted on this project's object.
    replyCount(project: P): number
  }
  // Required when the integration has a connection: its deliveries are recorded for the settings page.
  recorded?: {
    status(): DeliveryStatus
    createdSummary(project: P): string
  }
}

let workflowN = 0
export function makeWorkflow() {
  return db.insert(schema.workflows).values({
    name: `webhook-route-${++workflowN}`,
    steps: [{ type: 'bash', command: 'true', id: 'run' }],
    publishedAt: new Date(),
  }).returning().get()
}

export function makeTrigger(source: IntegrationId, projectIds: number[], config: TriggerConfig, active = true) {
  return db.insert(schema.triggers).values({
    source,
    workflowId: makeWorkflow().id,
    projectIds,
    active,
    config: { ...config },
  }).returning().get()
}

export function runsOf(triggerId: number) {
  return db.select().from(schema.runs).where(eq(schema.runs.triggerId, triggerId)).all()
}

export function describeIntegrationWebhook<P extends Project, D>(fx: WebhookFixture<P, D>) {
  const { id } = fx.integration
  const deliver = (delivery: D, secret?: string) => callRoute(fx.handler, fx.request(delivery, secret))

  describe(`${id} webhook route, unconfigured`, () => {
    it('answers 404 until the integration is connected', async () => {
      const res = await deliver(fx.unknownProject(), 'anything')
      expect(res.status).toBe(404)
    })
  })

  describe(`${id} webhook route`, () => {
    beforeAll(() => {
      fx.configure()
    })

    it('rejects a bad signature', async () => {
      const res = await deliver(fx.created.delivery(fx.makeProject()), 'wrong')
      expect(res.status).toBe(401)
    })

    it('rejects an empty body', async () => {
      const { headers } = fx.request(fx.created.delivery(fx.makeProject()))
      const res = await callRoute(fx.handler, { body: '', headers })
      expect(res.status).toBe(400)
    })

    it('skips deliveries that belong to no project', async () => {
      const res = await deliver(fx.unknownProject())
      expect(res.status).toBe(200)
      expect(res.json).toEqual({ ok: true, skipped: 'no matching project' })
    })

    it('fires on a created object with the object as inputs and session', async () => {
      const project = fx.makeProject()
      const trigger = makeTrigger(id, [project.id], fx.created.config)
      const res = await deliver(fx.created.delivery(project))
      expect(res.json).toEqual({ ok: true, runIds: [expect.any(Number)] })
      const [run] = runsOf(trigger.id)
      expect(run).toMatchObject(fx.created.run(project))
      expect(getSessionRow(run!.sessionId)).toMatchObject(fx.created.session(project))
    })

    it('leaves inactive triggers and triggers of other projects alone', async () => {
      const project = fx.makeProject()
      const inactive = makeTrigger(id, [project.id], fx.created.config, false)
      const elsewhere = makeTrigger(id, [fx.makeProject().id], fx.created.config)
      await deliver(fx.created.delivery(project))
      expect(runsOf(inactive.id)).toHaveLength(0)
      expect(runsOf(elsewhere.id)).toHaveLength(0)
    })

    it('runs every trigger matching one object on the same session', async () => {
      const project = fx.makeProject()
      const first = makeTrigger(id, [project.id], fx.created.config)
      const second = makeTrigger(id, [project.id], fx.created.config)
      const res = await deliver(fx.created.delivery(project))
      expect(res.json).toEqual({ ok: true, runIds: [expect.any(Number), expect.any(Number)] })
      expect(runsOf(first.id)[0]!.sessionId).toBe(runsOf(second.id)[0]!.sessionId)
    })

    it('fires on a label only when the object gains it', async () => {
      const project = fx.makeProject()
      const trigger = makeTrigger(id, [project.id], fx.labeled.config)
      for (const delivery of fx.labeled.notGained(project)) await deliver(delivery)
      expect(runsOf(trigger.id)).toHaveLength(0)
      await deliver(fx.labeled.gained(project))
      expect(runsOf(trigger.id)).toHaveLength(1)
    })

    it('mirrors closed and reopened onto the session', async () => {
      const project = fx.makeProject()
      const session = resolveSession(project, fx.object(project), null)
      await deliver(fx.closed(project))
      expect(getSessionRow(session.id).status).toBe('closed')
      await deliver(fx.reopened(project))
      expect(getSessionRow(session.id).status).toBe('open')
    })

    it('answers a mention on the object and opens its session', async () => {
      const project = fx.makeProject()
      const replies = fx.comment.replyCount(project)
      const res = await deliver(fx.comment.mention(project))
      expect(res.json).toMatchObject({ ok: true, outcome: expect.stringContaining('setup hint') })
      expect(fx.comment.replyCount(project)).toBe(replies + 1)
      expect(getSessionRow(resolveSession(project, fx.object(project), null).id).objectIntegration).toBe(id)
    })

    it('ignores its own comments and comments without a mention', async () => {
      const project = fx.makeProject()
      const replies = fx.comment.replyCount(project)
      expect((await deliver(fx.comment.fromSelf(project))).json)
        .toMatchObject({ outcome: expect.stringContaining('Knecht itself') })
      expect((await deliver(fx.comment.withoutMention(project))).json)
        .toMatchObject({ outcome: expect.stringContaining('no mention') })
      expect(fx.comment.replyCount(project)).toBe(replies)
    })

    it.skipIf(!fx.integration.connection)('remembers the last accepted and the last rejected delivery', async () => {
      const { status, createdSummary } = fx.recorded!
      const project = fx.makeProject()
      await deliver(fx.created.delivery(project))
      expect(status().lastDelivery).toMatchObject({ summary: createdSummary(project), at: expect.any(Number) })

      await deliver(fx.created.delivery(project), 'wrong')
      expect(status().lastRejected).toMatchObject({ reason: 'signature', at: expect.any(Number) })

      await callRoute(fx.handler, { body: '', headers: fx.request(fx.created.delivery(project)).headers })
      expect(status().lastRejected?.reason).toBe('empty-body')

      await deliver(fx.unknownProject())
      expect(status().lastRejected?.reason).toBe('no-project')
      expect(status().lastDelivery?.summary).toBe(createdSummary(project))
    })
  })
}
