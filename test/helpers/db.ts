import { asc, eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import type { Project, Run, Session } from '../../server/db/schema'
import { ensureStepIds, type Step } from '../../shared/utils/workflow'

// Minimal row builders for engine tests. Tests assert on the persisted
// contract (runs/run_steps rows), so a new required column gets its default
// here once instead of in every test.

let nextGithubId = 1

export function makeProject(overrides: Partial<typeof schema.projects.$inferInsert> = {}): Project {
  return db.insert(schema.projects).values({
    githubId: nextGithubId++,
    owner: 'knecht-works',
    name: 'test-php',
    fullName: 'knecht-works/test-php',
    defaultBranch: 'main',
    cloneUrl: 'https://github.com/knecht-works/test-php.git',
    ...overrides,
  }).returning().get()
}

// A one-shot session for a run to execute in (every run needs one, ADR 0006).
export function makeSession(project: Project, overrides: Partial<typeof schema.sessions.$inferInsert> = {}): Session {
  return db.insert(schema.sessions).values({
    projectId: project.id,
    ...overrides,
  }).returning().get()
}

// A queued run with its step sequence already pinned (the runner executes the
// snapshot; no workflows row is needed), inside a fresh one-shot session.
export function makeRun(project: Project, steps: Step[], overrides: Partial<typeof schema.runs.$inferInsert> = {}): Run {
  return db.insert(schema.runs).values({
    projectId: project.id,
    sessionId: overrides.sessionId ?? makeSession(project).id,
    workflow: 'engine-test',
    steps: ensureStepIds(steps),
    ...overrides,
  }).returning().get()
}

export function getSessionRow(sessionId: number): Session {
  return db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()!
}

export function getRun(runId: number): Run {
  return db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get()!
}

export function getSteps(runId: number) {
  return db.select().from(schema.runSteps).where(eq(schema.runSteps.runId, runId)).orderBy(asc(schema.runSteps.id)).all()
}

export function requeue(runId: number): void {
  db.update(schema.runs).set({ status: 'queued' }).where(eq(schema.runs.id, runId)).run()
}
