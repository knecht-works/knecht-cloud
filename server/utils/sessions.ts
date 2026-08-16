import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project, Session } from '../db/schema'

// Session resolution (ADR 0006): an object (GitHub issue or PR) has at most
// ONE session per project, forever; every trigger firing and mention on the
// object flows into it. Events without an object get a fresh one-shot
// session. The session row is the identity; its env walks the retention
// ladder independently (daemon/envs.ts).

export interface SessionObject {
  kind: 'issue' | 'pull_request'
  number: number
  url?: string
  title?: string
}

// Find the object's session. Object-less lookups have no session to find.
export function findObjectSession(projectId: number, object: SessionObject): Session | undefined {
  return db
    .select()
    .from(schema.sessions)
    .where(and(
      eq(schema.sessions.projectId, projectId),
      eq(schema.sessions.objectKind, object.kind),
      eq(schema.sessions.objectNumber, object.number),
    ))
    .get()
}

// The session an event on `object` lands in: the object's existing session,
// or a fresh one. A null object always creates a fresh one-shot session.
// `branch` seeds the session's checkout branch on creation only (a PR
// session pins its head branch; later events never re-point a checkout).
export function resolveSession(project: Project, object: SessionObject | null, branch: string | null): Session {
  if (object) {
    const existing = findObjectSession(project.id, object)
    if (existing) {
      // Keep the display fields fresh (titles get edited); never the branch.
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
      objectKind: object?.kind ?? null,
      objectNumber: object?.number ?? null,
      objectUrl: object?.url ?? null,
      objectTitle: object?.title ?? null,
      branch: branch ?? project.defaultBranch,
    })
    .returning()
    .get()
}

// Mirror the object's state onto its session (webhook closed/reopened
// deliveries). A session for an object we never worked on doesn't exist;
// that's fine, nothing to mirror.
export function syncObjectStatus(projectId: number, object: SessionObject, status: 'open' | 'closed'): void {
  const session = findObjectSession(projectId, object)
  if (!session || session.status === status) return
  db.update(schema.sessions)
    .set({ status, closedAt: status === 'closed' ? new Date() : null })
    .where(eq(schema.sessions.id, session.id))
    .run()
}

// Whether the session has work queued or executing (a run or a follow-up):
// the guard for operations that would rip the env out from under the agent
// (stop, archive) and for refusing parallel follow-ups. The dispatcher uses
// its own live view; this is the API-facing check.
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
