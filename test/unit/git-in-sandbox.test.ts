import { describe, expect, it, vi } from 'vitest'
import type { ActionRuntime } from '../../server/workflows/actions/types'

const hostSpawns = vi.hoisted(() => [] as unknown[][])
vi.mock('execa', () => ({
  execa: (...args: unknown[]) => {
    hostSpawns.push(args)
    throw new Error('host-side spawn')
  },
}))

const { commitAll, createBranch, currentBranch, pushBranch } = await import('../../server/daemon/git')
const credentials = { cloneUrl: 'https://github.com/acme/app.git', username: 'x-access-token', token: 'secret-token' }

function recordingSandbox() {
  const calls: { command: string[], env?: Record<string, string> }[] = []
  const sandbox = {
    exec: async (command: string[], opts?: { env?: Record<string, string> }) => {
      calls.push({ command, env: opts?.env })
      return command.includes('--name-only') ? 'changed.txt\n' : 'abc123\n'
    },
  } as unknown as ActionRuntime['sandbox']
  return { sandbox, calls }
}

// The sandbox can write .git: git on the host would run its hooks, fsmonitor and filters.
describe('git on a session checkout', () => {
  it('runs every operation inside the sandbox, never on the host', async () => {
    const { sandbox, calls } = recordingSandbox()
    await createBranch(sandbox, 'work')
    await currentBranch(sandbox)
    await commitAll(sandbox, 'msg')
    await pushBranch(sandbox, 'work', credentials)
    expect(hostSpawns).toEqual([])
    expect(calls.every(c => c.command[0] === 'git')).toBe(true)
    expect(calls.map(c => c.command.slice(1).find(a => !a.startsWith('-') && !a.includes('=')))).toEqual(
      ['checkout', 'rev-parse', 'add', 'diff', 'commit', 'rev-parse', 'push'],
    )
  })

  it('hands the push token over in the environment, not the command line', async () => {
    const { sandbox, calls } = recordingSandbox()
    await pushBranch(sandbox, 'work', credentials)
    const basic = Buffer.from('x-access-token:secret-token').toString('base64')
    expect(JSON.stringify(calls[0]!.command)).not.toContain(basic)
    expect(calls[0]!.env).toMatchObject({ GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}` })
  })
})
