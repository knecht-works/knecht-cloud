import type { Project, Session } from '../db/schema'
import type { IntegrationId, ObjectKind } from '../../shared/utils/integrations'
import { getIntegration } from '../integrations'
import { sessionPreviewUrl } from './preview-target'
import { getSessionRow, findObjectSession, createSession, updateSession } from '../stores/sessions'
import { latestSessionPrUrl, sessionHasActiveRun } from '../stores/runs'
import { sessionHasActiveFollowup } from '../stores/followups'

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

// `branch` seeds the checkout on creation only: later events never re-point a checkout.
export function resolveSession(project: Project, object: SessionObject | null, branch: string | null): Session {
  if (object) {
    const existing = findObjectSession(project.id, object)
    if (existing) {
      if (object.title && object.title !== existing.objectTitle) {
        updateSession(existing.id, { objectTitle: object.title })
        existing.objectTitle = object.title
      }
      return existing
    }
  }
  return createSession({
    projectId: project.id,
    objectIntegration: object?.integration ?? null,
    objectKind: object?.kind ?? null,
    objectKey: object?.key ?? null,
    objectUrl: object?.url ?? null,
    objectTitle: object?.title ?? null,
    branch: branch ?? project.defaultBranch,
  })
}

export function syncObjectStatus(projectId: number, object: SessionObject, status: 'open' | 'closed'): void {
  const session = findObjectSession(projectId, object)
  if (!session || session.status === status) return
  updateSession(session.id, { status, closedAt: status === 'closed' ? new Date() : null })
}

export function sessionHasActiveWork(sessionId: number): boolean {
  return sessionHasActiveRun(sessionId) || sessionHasActiveFollowup(sessionId)
}

export function withSessionLinks(text: string, sessionId: number): string {
  const session = getSessionRow(sessionId)
  if (!session) return text
  const links: string[] = []
  const preview = sessionPreviewUrl(session)
  if (preview) links.push(`**Preview:** ${preview}`)
  if (session.objectKind !== 'pull_request') {
    const prUrl = latestSessionPrUrl(sessionId)
    if (prUrl) links.push(`**PR:** ${prUrl}`)
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
