import { asc, eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import type { Project, Run, Session } from '../../server/db/schema'
import { ensureStepIds, type Step } from '../../shared/utils/workflow'

let nextRepoId = 1

export function makeProject(overrides: Partial<typeof schema.projects.$inferInsert> = {}): Project {
  return db.insert(schema.projects).values({
    repoId: String(nextRepoId++),
    owner: 'knecht-works',
    name: 'test-php',
    fullName: 'knecht-works/test-php',
    defaultBranch: 'main',
    ...overrides,
  }).returning().get()
}

export function makeMember(login: string): void {
  const member = db.insert(schema.members).values({ login }).returning().get()
  db.insert(schema.memberIdentities).values({ memberId: member.id, provider: 'github', subject: String(member.id), username: login, verified: true }).run()
}

export function makeSession(project: Project, overrides: Partial<typeof schema.sessions.$inferInsert> = {}): Session {
  return db.insert(schema.sessions).values({
    projectId: project.id,
    ...overrides,
  }).returning().get()
}

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
