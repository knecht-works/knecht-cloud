import type { Project, Session, SessionObjectRow } from '../db/schema'
import type { IntegrationId, ObjectKind } from '../../shared/utils/integrations'
import { getIntegration } from '../integrations'
import { sessionPreviewUrl } from './preview-target'
import { getSessionRow, findBranchSession, createSession, requireSession, sessionChanged, updateSession } from '../stores/sessions'
import { findObjectRow, insertObjectRow, listSessionObjectRows, updateObjectRow } from '../stores/session-objects'
import { latestSessionPrUrl, sessionHasActiveRun } from '../stores/runs'
import { sessionHasActiveFollowup } from '../stores/followups'

export interface SessionObject {
  integration: IntegrationId
  kind: ObjectKind
  key: string
  url?: string
  title?: string
}

function toSessionObject(row: SessionObjectRow): SessionObject {
  return {
    integration: row.integration,
    kind: row.kind,
    key: row.key,
    url: row.url ?? undefined,
    title: row.title ?? undefined,
  }
}

export function sessionObjects(sessionId: number): SessionObject[] {
  return listSessionObjectRows(sessionId).map(toSessionObject)
}

// The object work without one of its own talks to: the ticket if there is one, else the first attached.
export function primaryObject(sessionId: number): SessionObject | null {
  const [row] = listSessionObjectRows(sessionId)
  return row ? toSessionObject(row) : null
}

export function describeObject(object: SessionObject): string {
  return getIntegration(object.integration).objects.describe(object)
}

export interface ResolvedSession {
  session: Session
  objectId: number | null
}

// An event finds its session through anything attached to it: the object itself, or for a pull
// request the session working on its head branch. `branch` seeds the checkout on creation only.
export function resolveObjectSession(project: Project, object: SessionObject | null, branch: string | null): ResolvedSession {
  if (object) {
    const row = findObjectRow(project.id, object)
    if (row) {
      if ((object.title && object.title !== row.title) || (object.url && object.url !== row.url)) {
        updateObjectRow(row.id, { title: object.title ?? row.title, url: object.url ?? row.url })
        sessionChanged(row.sessionId)
      }
      return { session: requireSession(row.sessionId), objectId: row.id }
    }
    const working = object.kind === 'pull_request' && branch ? findBranchSession(project, branch) : undefined
    if (working) return { session: working, objectId: attachObject(working, object).id }
  }
  const session = createSession({ projectId: project.id, branch: branch ?? project.defaultBranch })
  return { session, objectId: object ? attachObject(session, object).id : null }
}

export function resolveSession(project: Project, object: SessionObject | null, branch: string | null): Session {
  return resolveObjectSession(project, object, branch).session
}

// An object already attached elsewhere stays there: the first session to claim it keeps it.
export function attachObject(session: Session, object: SessionObject): SessionObjectRow {
  const existing = findObjectRow(session.projectId, object)
  if (existing) return existing
  const row = insertObjectRow(session.id, session.projectId, object)
  sessionChanged(session.id)
  return row
}

// A PR opened from a session belongs to its work; the webhook of the PR then finds this session.
export function attachPullRequest(session: Session, project: Project, pr: { number: number, url: string }, title: string): void {
  attachObject(session, { integration: project.repoProvider, kind: 'pull_request', key: String(pr.number), url: pr.url, title })
}

export function syncObjectStatus(projectId: number, object: SessionObject, status: 'open' | 'closed'): void {
  const row = findObjectRow(projectId, object)
  if (!row) return
  if (row.status !== status) updateObjectRow(row.id, { status })
  const session = requireSession(row.sessionId)
  if (session.status === status) return
  updateSession(session.id, { status, closedAt: status === 'closed' ? new Date() : null })
}

export function sessionHasActiveWork(sessionId: number): boolean {
  return sessionHasActiveRun(sessionId) || sessionHasActiveFollowup(sessionId)
}

export function withSessionLinks(text: string, sessionId: number, target: SessionObject): string {
  const session = getSessionRow(sessionId)
  if (!session) return text
  const links: string[] = []
  const preview = sessionPreviewUrl(session)
  if (preview) links.push(`**Preview:** ${preview}`)
  if (target.kind !== 'pull_request') {
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
