import { asc, eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import type { Project, Run } from '../../server/db/schema'
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

// A queued run with its step sequence already pinned (the runner executes the
// snapshot; no workflows row is needed).
export function makeRun(project: Project, steps: Step[], overrides: Partial<typeof schema.runs.$inferInsert> = {}): Run {
  return db.insert(schema.runs).values({
    projectId: project.id,
    workflow: 'engine-test',
    steps: ensureStepIds(steps),
    ...overrides,
  }).returning().get()
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
