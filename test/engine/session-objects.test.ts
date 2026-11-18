import { describe, expect, it } from 'vitest'
import { updateSession } from '../../server/stores/sessions'
import { attachObject, attachPullRequest, primaryObject, resolveObjectSession, resolveSession, sessionObjects } from '../../server/utils/sessions'
import { makeProject } from '../helpers/db'

const ticket = { integration: 'jira' as const, kind: 'issue' as const, key: 'KN-1', title: 'Login fails' }
const pr = (key: string) => ({ integration: 'github' as const, kind: 'pull_request' as const, key, title: 'Fix login' })

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
