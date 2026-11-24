import { describe, expect, it } from 'vitest'
import { db, schema } from '#server/db'
import { fireTrigger } from '#server/utils/triggers'
import { updateSession } from '#server/stores/sessions'
import { attachObject, attachPullRequest, primaryObject, resolveObjectSession, resolveSession, sessionObjects, syncObjectStatus, workObject } from '#server/utils/sessions'
import { getRun, getSessionRow, makeProject } from '../helpers/db'

const ticket = { integration: 'jira' as const, kind: 'issue' as const, key: 'KN-1', title: 'Login fails' }
const pr = (key: string) => ({ integration: 'github' as const, kind: 'pull_request' as const, key, title: 'Fix login' })

let n = 0
function makeTrigger(projectId: number) {
  const wf = db.insert(schema.workflows).values({
    name: `objects-test-${++n}`,
    steps: [{ type: 'bash', command: 'true', id: 'run' }],
    publishedAt: new Date(),
  }).returning().get()
  return db.insert(schema.triggers).values({ source: 'github', workflowId: wf.id, projectIds: [projectId] }).returning().get()
}

describe('a session holds the objects of one piece of work', () => {
  it('finds the session again through a PR it opened', () => {
    const project = makeProject()
    const session = resolveSession(project, ticket, null)
    attachPullRequest(session, project, { number: 42, url: 'https://x/pull/42' }, 'Fix login')

    expect(resolveSession(project, pr('42'), 'knecht/kn-1').id).toBe(session.id)
    expect(sessionObjects(session.id).map(o => o.key)).toEqual(['KN-1', '42'])
  })

  it('attaches a PR opened elsewhere to the session working on its head branch', () => {
    const project = makeProject()
    const session = resolveSession(project, null, null)
    updateSession(session.id, { branch: 'feature/checkout' })

    const found = resolveObjectSession(project, pr('7'), 'feature/checkout')
    expect(found.session.id).toBe(session.id)
    expect(found.objectId).not.toBeNull()
    expect(primaryObject(session.id)?.key).toBe('7')
  })

  it('never matches a session still on its base branch', () => {
    const project = makeProject()
    const { session } = resolveObjectSession(project, null, null, 'develop')

    expect(resolveSession(project, pr('11'), 'develop').id).not.toBe(session.id)
  })

  it('never matches the default branch', () => {
    const project = makeProject()
    const session = resolveSession(project, null, null)

    expect(resolveSession(project, pr('8'), 'main').id).not.toBe(session.id)
  })

  it('keeps an object in the first session that claimed it', () => {
    const project = makeProject()
    const first = resolveSession(project, pr('9'), 'feature/a')
    const other = resolveSession(project, null, null)
    attachPullRequest(other, project, { number: 9, url: 'https://x/pull/9' }, 'Fix login')

    expect(resolveSession(project, pr('9'), null).id).toBe(first.id)
    expect(sessionObjects(other.id)).toEqual([])
  })

  it('makes the ticket the primary object, whatever attached first', () => {
    const project = makeProject()
    const session = resolveSession(project, pr('10'), 'feature/b')
    attachObject(session, ticket)

    expect(primaryObject(session.id)?.key).toBe('KN-1')
  })
})

describe('work answers where it came from', () => {
  it('runs on the PR carry the PR, so the review replies there', () => {
    const project = makeProject()
    const session = resolveSession(project, ticket, null)
    attachPullRequest(session, project, { number: 42, url: 'https://x/pull/42' }, 'Fix login')

    const [runId] = fireTrigger(makeTrigger(project.id), { object: pr('42'), branch: 'knecht/kn-1' })
    const run = getRun(runId!)
    expect(run.sessionId).toBe(session.id)
    expect(workObject(session.id, run.objectId)?.key).toBe('42')
    expect(workObject(session.id, null)?.key).toBe('KN-1')
  })

  it('runs a workflow once per object version, per object', () => {
    const project = makeProject()
    const session = resolveSession(project, ticket, null)
    attachPullRequest(session, project, { number: 42, url: 'https://x/pull/42' }, 'Fix login')
    const trigger = makeTrigger(project.id)
    const version = '2026-11-18T14:03:12Z'

    expect(fireTrigger(trigger, { object: ticket, version })).toHaveLength(1)
    expect(fireTrigger(trigger, { object: pr('42'), version })).toHaveLength(1)
    expect(fireTrigger(trigger, { object: pr('42'), version })).toHaveLength(0)
  })
})

describe('session lifecycle', () => {
  it('closes only once all of its objects are closed', () => {
    const project = makeProject()
    const session = resolveSession(project, ticket, null)
    attachPullRequest(session, project, { number: 42, url: 'https://x/pull/42' }, 'Fix login')

    syncObjectStatus(project.id, ticket, 'closed')
    expect(getSessionRow(session.id).status).toBe('open')

    expect(syncObjectStatus(project.id, pr('42'), 'closed')?.status).toBe('closed')
    expect(getSessionRow(session.id).closedAt).not.toBeNull()
  })

  it('reopens when a new open object attaches', () => {
    const project = makeProject()
    const session = resolveSession(project, ticket, null)
    syncObjectStatus(project.id, ticket, 'closed')

    attachPullRequest(getSessionRow(session.id), project, { number: 43, url: 'https://x/pull/43' }, 'Follow-up fix')
    expect(getSessionRow(session.id)).toMatchObject({ status: 'open', closedAt: null })
  })
})
