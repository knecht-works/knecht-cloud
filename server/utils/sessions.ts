import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project, Session } from '../db/schema'
import type { IntegrationId, ObjectKind } from '../../shared/utils/integrations'
import { getIntegration } from '../integrations'
import { sessionPreviewUrl } from './preview-target'

export interface SessionObject {
  integration: IntegrationId
  kind: ObjectKind
  key: string
  url?: string
  title?: string
}

export function sessionObject(session: Session): SessionObject | null {
  if (!session.objectIntegration || !session.objectKind || !session.objectKey) return null
  return {
    integration: session.objectIntegration,
    kind: session.objectKind,
    key: session.objectKey,
    url: session.objectUrl ?? undefined,
    title: session.objectTitle ?? undefined,
  }
}

export function describeObject(object: SessionObject): string {
  return getIntegration(object.integration).objects.describe(object)
}

export function findObjectSession(projectId: number, object: SessionObject): Session | undefined {
  return db
    .select()
    .from(schema.sessions)
    .where(and(
      eq(schema.sessions.projectId, projectId),
      eq(schema.sessions.objectIntegration, object.integration),
      eq(schema.sessions.objectKind, object.kind),
      eq(schema.sessions.objectKey, object.key),
    ))
    .get()
}

// `branch` seeds the checkout on creation only: later events never re-point a checkout.
export function resolveSession(project: Project, object: SessionObject | null, branch: string | null): Session {
  if (object) {
    const existing = findObjectSession(project.id, object)
    if (existing) {
      if (object.title && object.title !== existing.objectTitle) {
        db.update(schema.sessions)
          .set({ objectTitle: object.title })
          .where(eq(schema.sessions.id, existing.id))
          .run()
        existing.objectTitle = object.title
      }
      return existing
    }
  }
  return db
    .insert(schema.sessions)
    .values({
      projectId: project.id,
      objectIntegration: object?.integration ?? null,
      objectKind: object?.kind ?? null,
      objectKey: object?.key ?? null,
      objectUrl: object?.url ?? null,
      objectTitle: object?.title ?? null,
      branch: branch ?? project.defaultBranch,
    })
    .returning()
    .get()
}

export function syncObjectStatus(projectId: number, object: SessionObject, status: 'open' | 'closed'): void {
  const session = findObjectSession(projectId, object)
  if (!session || session.status === status) return
  db.update(schema.sessions)
    .set({ status, closedAt: status === 'closed' ? new Date() : null })
    .where(eq(schema.sessions.id, session.id))
    .run()
}

export function sessionHasActiveWork(sessionId: number): boolean {
  const run = db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(
      eq(schema.runs.sessionId, sessionId),
      inArray(schema.runs.status, ['queued', 'running']),
    ))
    .get()
  if (run) return true
  const followup = db
    .select({ id: schema.followups.id })
    .from(schema.followups)
    .where(and(
      eq(schema.followups.sessionId, sessionId),
      inArray(schema.followups.status, ['queued', 'running']),
    ))
    .get()
  return Boolean(followup)
}

export function withSessionLinks(text: string, sessionId: number): string {
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()
  if (!session) return text
  const links: string[] = []
  const preview = sessionPreviewUrl(session)
  if (preview) links.push(`**Preview:** ${preview}`)
  if (session.objectKind !== 'pull_request') {
    const run = db
      .select({ prUrl: schema.runs.prUrl })
      .from(schema.runs)
      .where(and(eq(schema.runs.sessionId, sessionId), isNotNull(schema.runs.prUrl)))
      .orderBy(desc(schema.runs.id))
      .get()
    if (run?.prUrl) links.push(`**PR:** ${run.prUrl}`)
  }
  if (!links.length) return text
  return `${text.trim()}\n\n---\n${links.join(' · ')}`
}

const agentReplies = new Map<number, number>()

export function recordAgentReply(sessionId: number): void {
  agentReplies.set(sessionId, Date.now())
}

export function agentRepliedSince(sessionId: number, since: Date): boolean {
  return (agentReplies.get(sessionId) ?? 0) >= since.getTime()
}
