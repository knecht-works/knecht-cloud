import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { eq, type SQL } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import { dataDir } from '../../server/utils/storage'
import { getSteps, makeProject, makeRun, makeSession } from '../helpers/db'

// Disconnecting a project (utils/projects.ts): every row it owns goes in the
// synchronous phase, work executing for it is aborted, and the background
// phase tears down the per-session envs and the project's own folders. Same
// wiring as runner.test.ts: real runner and DB, faked container boundary.

vi.mock('../../server/daemon/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/daemon/git')>()
  const { fakeCheckout } = await import('../helpers/local-sandbox')
  return { ...actual, prepareSessionCheckout: fakeCheckout }
})
vi.mock('../../server/daemon/sandbox', async () => {
  const { execInSandbox, copyIntoSandbox } = await import('../helpers/local-sandbox')
  return { execInSandbox, copyIntoSandbox }
})
const tornDown: number[] = []
vi.mock('../../server/daemon/envs', () => ({
  ensureEnvUp: async () => {},
  teardownSession: async (sessionId: number) => { tornDown.push(sessionId) },
}))
vi.mock('../../server/utils/github-app', () => ({
  getInstallationToken: async () => 'test-token',
  getBotIdentity: async () => ({ name: 'Knecht Test', email: 'test@knecht.works' }),
}))
vi.mock('../../server/utils/jira', () => ({ addJiraComment: async () => {} }))

const { deleteProject } = await import('../../server/utils/projects')
const { startRun } = await import('../../server/daemon/runner')

function count(table: typeof schema.runs | typeof schema.sessions | typeof schema.runSteps | typeof schema.followups, where: SQL) {
  return db.select().from(table).where(where).all().length
}

function makeDir(...parts: string[]): string {
  const dir = join(dataDir(), ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('deleteProject', () => {
  it('drops every row the project owns, trims trigger references and removes its folders', async () => {
    const project = makeProject()
    const other = makeProject()

    // Two sessions with finished runs, steps and a follow-up.
    const runA = makeRun(project, [], { status: 'success' })
    const runB = makeRun(project, [], { status: 'failed' })
    db.insert(schema.runSteps).values({ runId: runA.id, stepIndex: 0, stepId: 'x', type: 'bash', status: 'success' }).run()
    db.insert(schema.followups).values({ sessionId: runA.sessionId, runId: runA.id, prompt: 'again', origin: 'followup', status: 'success' }).run()
    const otherRun = makeRun(other, [], { status: 'success' })

    const workflow = db.insert(schema.workflows).values({ name: 'wf', steps: [] }).returning().get()
    const trigger = db.insert(schema.triggers).values({ source: 'manual', workflowId: workflow.id, projectIds: [project.id, other.id] }).returning().get()

    const dirs = [
      makeDir('dumps', String(project.id)),
      makeDir('shared', String(project.id)),
      makeDir('memory', String(project.id)),
      makeDir('archives', `run-${runA.sessionId}`),
    ]
    const otherDir = makeDir('memory', String(other.id))

    const background = deleteProject(project.id)

    // Phase 1 is done before the promise settles.
    expect(db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get()).toBeUndefined()
    expect(count(schema.sessions, eq(schema.sessions.projectId, project.id))).toBe(0)
    expect(count(schema.runs, eq(schema.runs.projectId, project.id))).toBe(0)
    expect(count(schema.runSteps, eq(schema.runSteps.runId, runA.id))).toBe(0)
    expect(count(schema.followups, eq(schema.followups.sessionId, runA.sessionId))).toBe(0)
    expect(db.select().from(schema.triggers).where(eq(schema.triggers.id, trigger.id)).get()!.projectIds).toEqual([other.id])

    await background
    expect(tornDown).toEqual(expect.arrayContaining([runA.sessionId, runB.sessionId]))
    for (const dir of dirs) expect(existsSync(dir)).toBe(false)

    // The other project is untouched.
    expect(count(schema.runs, eq(schema.runs.id, otherRun.id))).toBe(1)
    expect(count(schema.sessions, eq(schema.sessions.id, otherRun.sessionId))).toBe(1)
    expect(existsSync(otherDir)).toBe(true)
    expect(tornDown).not.toContain(otherRun.sessionId)
  })

  it('aborts a run executing for the project', async () => {
    const project = makeProject()
    const run = makeRun(project, [{ type: 'bash', id: 'forever', command: 'sleep 30' }])
    const done = startRun(run.id, project)
    for (let i = 0; i < 100 && getSteps(run.id).length === 0; i++) await sleep(50)
    expect(getSteps(run.id).length).toBe(1)

    const started = Date.now()
    await deleteProject(project.id)
    // The runner returned promptly instead of sitting out the 30s step.
    await done
    expect(Date.now() - started).toBeLessThan(5000)
    expect(count(schema.runs, eq(schema.runs.id, run.id))).toBe(0)
    expect(count(schema.runSteps, eq(schema.runSteps.runId, run.id))).toBe(0)
  })

  it('cancels a queued follow-up and its mention run with the session', async () => {
    const project = makeProject()
    const session = makeSession(project)
    const mention = makeRun(project, [], { sessionId: session.id, kind: 'mention', workflow: 'Mention', trigger: 'mention' })
    db.insert(schema.followups).values({ sessionId: session.id, runId: mention.id, prompt: 'do it', origin: 'mention' }).run()

    await deleteProject(project.id)
    expect(count(schema.followups, eq(schema.followups.sessionId, session.id))).toBe(0)
    expect(count(schema.runs, eq(schema.runs.id, mention.id))).toBe(0)
    expect(tornDown).toContain(session.id)
  })

  it('is a no-op for an unknown project', async () => {
    await expect(deleteProject(999_999)).resolves.toBeUndefined()
  })
})
