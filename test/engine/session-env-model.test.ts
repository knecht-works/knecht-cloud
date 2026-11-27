import { mkdirSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { getSessionRow, makeProject, makeSession } from '../helpers/db'

interface World { stack: 'none' | 'running' | 'stopped', workspace: boolean, busy: number, overlapped: boolean }
const worlds = new Map<number, World>()
const sim = vi.hoisted(() => ({ scheduler: null as null | { schedule: <T>(p: Promise<T>) => Promise<T> } }))

function world(sessionId: number): World {
  const w = worlds.get(sessionId) ?? { stack: 'none', workspace: false, busy: 0, overlapped: false }
  worlds.set(sessionId, w)
  return w
}

// Every side effect yields to the scheduler, so fast-check decides what interleaves with it.
async function effect<T>(sessionId: number, change: (w: World) => T): Promise<T> {
  const w = world(sessionId)
  w.busy++
  if (w.busy > 1) w.overlapped = true
  try {
    await sim.scheduler!.schedule(Promise.resolve())
    return change(w)
  }
  finally {
    w.busy--
  }
}

vi.mock('#server/daemon/sandbox', () => ({
  envStackRunning: (id: number) => effect(id, w => w.stack === 'running'),
  forgetPreview: () => {},
  removeEnvStack: (id: number) => effect(id, (w) => { w.stack = 'none' }),
  runTag: () => ({}),
  startEnvStack: (id: number) => effect(id, (w) => { w.stack = 'running' }),
  stopEnvStack: (id: number) => effect(id, (w) => { if (w.stack === 'running') w.stack = 'stopped' }),
  streamInSandbox: async (id: number, _command: string[], _log: unknown, _env: unknown, signal?: AbortSignal) => {
    await effect(id, () => {})
    signal?.throwIfAborted()
    return { code: 0, tail: '' }
  },
}))
vi.mock('#server/daemon/workspace', () => ({
  ensureWorkspaceUp: (id: number) => effect(id, (w) => { w.workspace = true }),
  removeWorkspace: (id: number) => effect(id, (w) => { w.workspace = false }),
}))
vi.mock('#server/daemon/db-base', () => ({
  archiveDbVolume: async () => {},
  archivedDbVolume: () => null,
  readyDbBase: async () => null,
}))
vi.mock('#server/daemon/ddev', () => ({ configureSessionEnv: async () => ({ warnings: [], devServerPort: null }) }))
vi.mock('#server/daemon/git', () => ({
  prepareSessionCheckout: async (_project: unknown, id: number) => {
    const { sessionCheckoutDir } = await import('#server/utils/storage')
    mkdirSync(sessionCheckoutDir(id), { recursive: true })
  },
}))
vi.mock('#server/git', () => ({ gitProvider: () => ({ credentials: async () => ({}) }) }))
vi.mock('#server/utils/preview-certs', () => ({ warmPreviewCertificates: () => {} }))

const { db, schema } = await import('#server/db')
const { archiveEnv, bootSessionEnv, deleteEnv, envTransition, rebootEnv, releaseWorkspace, reviveEnv, reviveWithoutPreview, stopEnv } = await import('#server/daemon/envs')

const COMMANDS = ['boot', 'cancel', 'stop', 'stopByHand', 'reboot', 'archive', 'revive', 'lend', 'delete'] as const
type Command = typeof COMMANDS[number]

function worldFor(envState: 'up' | 'stopped' | 'archived', tier: 'code' | 'preview'): World {
  const stack = tier === 'code' || envState === 'archived' ? 'none' : envState === 'up' ? 'running' : 'stopped'
  return { stack, workspace: tier === 'code' && envState === 'up', busy: 0, overlapped: false }
}

function perform(sessionId: number, command: Command, aborts: AbortController[]): Promise<unknown> {
  switch (command) {
    case 'boot': {
      const abort = new AbortController()
      aborts.push(abort)
      return bootSessionEnv(sessionId, async () => ({ dbFile: null, projectCommands: 'install\nbuild', signal: abort.signal }))
    }
    case 'cancel':
      for (const abort of aborts) abort.abort()
      return Promise.resolve()
    case 'stop': return stopEnv(sessionId)
    case 'stopByHand': return stopEnv(sessionId, { byHand: true })
    case 'reboot': return rebootEnv(sessionId)
    case 'archive': return archiveEnv(sessionId)
    case 'revive': return reviveEnv(sessionId)
    case 'lend': return reviveWithoutPreview(sessionId).then(() => releaseWorkspace(sessionId))
    case 'delete':
      if (!getSessionRow(sessionId)) return Promise.resolve()
      db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run()
      return deleteEnv(sessionId)
  }
}

const ENV_STATES = ['up', 'stopped', 'archived'] as const
const TIERS = ['code', 'preview'] as const

// state, tier, operation: state, tier, stack, workspace
const TABLE: [string, string, Command, string, string, World['stack'], boolean][] = [
  ['up', 'code', 'boot', 'up', 'preview', 'running', false],
  ['up', 'code', 'stop', 'stopped', 'code', 'none', false],
  ['up', 'code', 'reboot', 'up', 'code', 'none', true],
  ['up', 'code', 'archive', 'up', 'code', 'none', true],
  ['up', 'code', 'revive', 'up', 'code', 'none', true],
  ['up', 'code', 'lend', 'up', 'code', 'none', true],
  ['up', 'preview', 'boot', 'up', 'preview', 'running', false],
  ['up', 'preview', 'stop', 'stopped', 'preview', 'stopped', false],
  ['up', 'preview', 'reboot', 'up', 'preview', 'running', false],
  ['up', 'preview', 'archive', 'up', 'preview', 'running', false],
  ['up', 'preview', 'revive', 'up', 'preview', 'running', false],
  ['up', 'preview', 'lend', 'up', 'preview', 'running', false],
  ['stopped', 'code', 'boot', 'up', 'preview', 'running', false],
  ['stopped', 'code', 'stop', 'stopped', 'code', 'none', false],
  ['stopped', 'code', 'reboot', 'up', 'code', 'none', true],
  ['stopped', 'code', 'archive', 'archived', 'code', 'none', false],
  ['stopped', 'code', 'revive', 'up', 'code', 'none', true],
  ['stopped', 'code', 'lend', 'stopped', 'code', 'none', false],
  ['stopped', 'preview', 'boot', 'up', 'preview', 'running', false],
  ['stopped', 'preview', 'stop', 'stopped', 'preview', 'stopped', false],
  ['stopped', 'preview', 'reboot', 'up', 'preview', 'running', false],
  ['stopped', 'preview', 'archive', 'archived', 'preview', 'none', false],
  ['stopped', 'preview', 'revive', 'up', 'preview', 'running', false],
  ['stopped', 'preview', 'lend', 'stopped', 'preview', 'stopped', false],
  ['archived', 'code', 'boot', 'up', 'preview', 'running', false],
  ['archived', 'code', 'stop', 'archived', 'code', 'none', false],
  ['archived', 'code', 'reboot', 'archived', 'code', 'none', false],
  ['archived', 'code', 'archive', 'archived', 'code', 'none', false],
  ['archived', 'code', 'revive', 'up', 'code', 'none', true],
  ['archived', 'code', 'lend', 'up', 'code', 'none', true],
  ['archived', 'preview', 'boot', 'up', 'preview', 'running', false],
  ['archived', 'preview', 'stop', 'archived', 'preview', 'none', false],
  ['archived', 'preview', 'reboot', 'archived', 'preview', 'none', false],
  ['archived', 'preview', 'archive', 'archived', 'preview', 'none', false],
  ['archived', 'preview', 'revive', 'up', 'preview', 'running', false],
  ['archived', 'preview', 'lend', 'up', 'preview', 'running', false],
]

describe('session environment, one operation at a time', () => {
  it.each(TABLE)('%s %s session, %s: ends %s %s, stack %s, workspace %s', async (envState, tier, command, state, endTier, stack, workspace) => {
    sim.scheduler = { schedule: p => p }
    const id = makeSession(makeProject(), { envState: envState as typeof ENV_STATES[number], tier: tier as typeof TIERS[number] }).id
    worlds.set(id, worldFor(envState as typeof ENV_STATES[number], tier as typeof TIERS[number]))
    await perform(id, command, []).catch(() => {})
    expect(getSessionRow(id)).toMatchObject({ envState: state, tier: endTier, envOperation: null })
    expect(world(id)).toMatchObject({ stack, workspace })
  })
})

describe('session environment under random operations', () => {
  it('keeps the containers in line with the session, whatever runs in between', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.constantFrom(...ENV_STATES),
        fc.constantFrom(...TIERS),
        fc.array(fc.constantFrom(...COMMANDS), { minLength: 1, maxLength: 8 }),
        async (s, envState, tier, commands) => {
          sim.scheduler = s
          const id = makeSession(makeProject(), { envState, tier }).id
          worlds.set(id, worldFor(envState, tier))
          const aborts: AbortController[] = []
          const done = commands.map(command => s.schedule(Promise.resolve()).then(() => perform(id, command, aborts)))
          await s.waitFor(Promise.allSettled(done))

          const w = world(id)
          const session = getSessionRow(id)
          expect(w.overlapped).toBe(false)
          expect(envTransition(id)).toBeNull()
          if (!session) {
            expect(w).toMatchObject({ stack: 'none', workspace: false })
            return
          }
          expect(session.envOperation).toBeNull()
          if (session.envState === 'up' && session.tier === 'preview') expect(w.stack).toBe('running')
          if (session.envState === 'up' && session.tier === 'code') expect(w).toMatchObject({ workspace: true })
          if (session.envState !== 'up') expect(w.stack).not.toBe('running')
          if (session.envState !== 'up') expect(w.workspace).toBe(false)
        },
      ),
      { numRuns: 300 },
    )
  })
})
