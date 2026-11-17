import { describe, expect, it, vi } from 'vitest'
import { makeProject, makeSession } from '../helpers/db'
import { credentialsFor, git, remoteWithMain } from '../helpers/git-remote'

vi.mock('../../server/utils/github-app', () => ({
  getBotIdentity: async () => ({ name: 'Knecht Test', email: 'test@knecht.works' }),
}))

const { prepareSessionCheckout } = await import('../../server/daemon/git')

describe('prepareSessionCheckout', () => {
  it('clones a branch that is on origin', async () => {
    const credentials = credentialsFor(remoteWithMain())
    const project = makeProject()
    const session = makeSession(project)
    const dir = await prepareSessionCheckout(project, session.id, credentials, () => {}, 'pushed')
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('pushed')
    expect(git(dir, 'show', 'HEAD:README.md')).toBe('pushed')
  })

  it('starts a branch that never reached origin from the default branch and says so', async () => {
    const credentials = credentialsFor(remoteWithMain())
    const project = makeProject()
    const session = makeSession(project)
    const log: string[] = []
    const dir = await prepareSessionCheckout(project, session.id, credentials, line => log.push(line), 'never-pushed')
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('never-pushed')
    expect(git(dir, 'show', 'HEAD:README.md')).toBe('main')
    expect(log.join('')).toContain('never-pushed is not on origin')
  })
})
