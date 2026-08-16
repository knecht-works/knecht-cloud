import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import { fireTrigger } from '../../server/utils/triggers'
import { findObjectSession, resolveSession, sessionHasActiveWork, syncObjectStatus } from '../../server/utils/sessions'
import { getSessionRow, makeProject, makeRun } from '../helpers/db'

// The session model (ADR 0006) against the real schema: one session per
// object, one-shot sessions for objectless events, status mirroring, and the
// busy check the API guards use.

let n = 0
function makePublishedWorkflow() {
  return db.insert(schema.workflows).values({
    name: `session-test-${++n}`,
    steps: [{ type: 'bash', command: 'true', id: 'run' }],
    publishedAt: new Date(),
  }).returning().get()
}

function makeTrigger(workflowId: number, projectIds: number[]) {
  return db.insert(schema.triggers).values({ source: 'github', workflowId, projectIds }).returning().get()
}

describe('resolveSession', () => {
  it('creates one session per object and finds it again', () => {
    const project = makeProject()
    const object = { kind: 'issue' as const, number: 17, url: 'https://x/17', title: 'Bug' }

    const first = resolveSession(project, object, null)
    expect(first.objectKind).toBe('issue')
    expect(first.objectNumber).toBe(17)
    expect(first.branch).toBe('main')

    const again = resolveSession(project, object, 'feature-x')
    expect(again.id).toBe(first.id)
    // The branch was pinned at creation; later events never re-point it.
    expect(again.branch).toBe('main')
  })

  it('refreshes the object title on later events', () => {
    const project = makeProject()
    const object = { kind: 'issue' as const, number: 3, title: 'Old title' }
    const first = resolveSession(project, object, null)
    resolveSession(project, { ...object, title: 'New title' }, null)
    expect(getSessionRow(first.id).objectTitle).toBe('New title')
  })

  it('creates a fresh one-shot session for every objectless event', () => {
    const project = makeProject()
    const a = resolveSession(project, null, null)
    const b = resolveSession(project, null, null)
    expect(a.id).not.toBe(b.id)
    expect(a.objectKind).toBeNull()
  })

  it('keeps the same object separate across projects', () => {
    const a = makeProject()
    const b = makeProject()
    const object = { kind: 'pull_request' as const, number: 5 }
    expect(resolveSession(a, object, null).id).not.toBe(resolveSession(b, object, null).id)
  })
})

describe('fireTrigger with objects', () => {
  it('routes two firings on the same object into ONE session', () => {
    const project = makeProject()
    const wf = makePublishedWorkflow()
    const trigger = makeTrigger(wf.id, [project.id])
    const object = { kind: 'issue' as const, number: 9, title: 'Flaky' }

    const [first] = fireTrigger(trigger, { object })
    const [second] = fireTrigger(trigger, { object })
    const runA = db.select().from(schema.runs).where(eq(schema.runs.id, first!)).get()!
    const runB = db.select().from(schema.runs).where(eq(schema.runs.id, second!)).get()!
    expect(runA.sessionId).toBe(runB.sessionId)

    const session = getSessionRow(runA.sessionId)
    expect(session.objectKind).toBe('issue')
    expect(session.objectNumber).toBe(9)
  })

  it('gives objectless firings their own one-shot sessions', () => {
    const project = makeProject()
    const wf = makePublishedWorkflow()
    const trigger = makeTrigger(wf.id, [project.id])

    const [first] = fireTrigger(trigger, {})
    const [second] = fireTrigger(trigger, {})
    const runA = db.select().from(schema.runs).where(eq(schema.runs.id, first!)).get()!
    const runB = db.select().from(schema.runs).where(eq(schema.runs.id, second!)).get()!
    expect(runA.sessionId).not.toBe(runB.sessionId)
  })
})

describe('syncObjectStatus', () => {
  it('mirrors close and reopen onto the session', () => {
    const project = makeProject()
    const object = { kind: 'issue' as const, number: 21 }
    const session = resolveSession(project, object, null)

    syncObjectStatus(project.id, object, 'closed')
    expect(getSessionRow(session.id).status).toBe('closed')
    expect(getSessionRow(session.id).closedAt).not.toBeNull()

    syncObjectStatus(project.id, object, 'open')
    expect(getSessionRow(session.id).status).toBe('open')
    expect(getSessionRow(session.id).closedAt).toBeNull()

    expect(findObjectSession(project.id, object)?.id).toBe(session.id)
  })

  it('ignores objects Knecht never worked on', () => {
    const project = makeProject()
    expect(() => syncObjectStatus(project.id, { kind: 'issue', number: 999 }, 'closed')).not.toThrow()
  })
})

describe('sessionHasActiveWork', () => {
  it('sees queued runs and queued follow-ups, not finished ones', () => {
    const project = makeProject()
    const run = makeRun(project, []) // status 'queued'
    expect(sessionHasActiveWork(run.sessionId)).toBe(true)

    db.update(schema.runs).set({ status: 'success' }).where(eq(schema.runs.id, run.id)).run()
    expect(sessionHasActiveWork(run.sessionId)).toBe(false)

    const followup = db.insert(schema.followups).values({
      sessionId: run.sessionId,
      runId: run.id,
      prompt: 'more',
    }).returning().get()
    expect(sessionHasActiveWork(run.sessionId)).toBe(true)

    db.update(schema.followups).set({ status: 'failed' }).where(eq(schema.followups.id, followup.id)).run()
    expect(sessionHasActiveWork(run.sessionId)).toBe(false)
  })
})
