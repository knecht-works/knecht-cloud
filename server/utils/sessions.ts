import type { Project, Session, SessionObjectRow } from '../db/schema'
import type { IntegrationId, ObjectKind } from '../../shared/utils/integrations'
import { getIntegration } from '../integrations'
import { sessionPreviewUrl } from './preview-target'
import { getSessionRow, findBranchSession, createSession, requireSession, sessionChanged, updateSession } from '../stores/sessions'
import { findObjectRow, getObjectRow, insertObjectRow, listSessionObjectRows, updateObjectRow } from '../stores/session-objects'
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

export function sessionObjectsWithIds(sessionId: number): { id: number, object: SessionObject }[] {
  return listSessionObjectRows(sessionId).map(row => ({ id: row.id, object: toSessionObject(row) }))
}

// The object work without one of its own talks to: the ticket if there is one, else the first attached.
export function primaryObject(sessionId: number): SessionObject | null {
  const [row] = listSessionObjectRows(sessionId)
  return row ? toSessionObject(row) : null
}

// Work answers where it came from: the object that caused it, else the session's primary object.
export function workObject(sessionId: number, objectId: number | null | undefined): SessionObject | null {
  const row = objectId ? getObjectRow(objectId) : undefined
  return row ? toSessionObject(row) : primaryObject(sessionId)
}

export function describeObject(object: SessionObject): string {
  return getIntegration(object.integration).objects.describe(object)
}

// One conversation spans work from every object of the session, so each turn says which one this task comes from.
export function taskBriefing(sessionId: number, objectId: number | null | undefined, askedBy: string | null | undefined, fromDashboard = false): string {
  const objects = sessionObjects(sessionId)
  const origin = workObject(sessionId, objectId)
  if (!origin) return ''
  const source = fromDashboard
    ? `${askedBy ?? 'A user'} asked this in the Knecht dashboard, about ${describeObject(origin)}: answer in your final message, and post on an object only when the task asks you to.`
    : `This task comes from ${describeObject(origin)}${askedBy ? `, asked by ${askedBy}` : ''}.`
  const others = objects.length > 1 ? ' To act on another of them, pass --on <KEY> to knecht-reply, knecht-label or knecht-status.' : ''
  return `This session holds ${objects.map(describeObject).join(', ')}. ${source}${others}\n\n`
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
  if (session.status === 'closed') updateSession(session.id, { status: 'open', closedAt: null })
  else sessionChanged(session.id)
  return row
}

// A PR opened from a session belongs to its work; the webhook of the PR then finds this session.
export function attachPullRequest(session: Session, project: Project, pr: { number: number, url: string }, title: string): void {
  attachObject(session, { integration: project.repoProvider, kind: 'pull_request', key: String(pr.number), url: pr.url, title })
}

// A session is closed once all of its objects are.
export function syncObjectStatus(projectId: number, object: SessionObject, status: 'open' | 'closed'): Session | undefined {
  const row = findObjectRow(projectId, object)
  if (!row) return undefined
  if (row.status !== status) updateObjectRow(row.id, { status })
  const session = requireSession(row.sessionId)
  const next = listSessionObjectRows(session.id).some(r => r.status === 'open') ? 'open' : 'closed'
  if (session.status === next) return session
  updateSession(session.id, { status: next, closedAt: next === 'closed' ? new Date() : null })
  return requireSession(session.id)
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
