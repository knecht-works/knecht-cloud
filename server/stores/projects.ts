import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { createError } from 'h3'
import { db, schema, type Executor } from '../db'
import type { DbBase, NewProject, Project } from '../db/schema'
import { liveTopics } from '../../shared/utils/live-topics'
import type { RepoProvider } from '../../shared/utils/integrations'
import { emitTopics } from '../utils/live'
import { deleteAgentItems } from './agent-items'
import { deleteFollowups } from './followups'
import { deleteProjectLinks } from './project-links'
import { deleteRunSteps } from './run-steps'
import { deleteProjectRuns, listProjectRunIds } from './runs'
import { deleteProjectSessions } from './sessions'
import { removeProjectFromTriggers } from './triggers'

type ProjectMeta = Partial<Pick<NewProject, 'framework' | 'frameworkVersion' | 'ddevEnv' | 'favicon'>>

export function getProject(id: number): Project | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()
}

export function requireProject(id: number): Project {
  const project = getProject(id)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  return project
}

export function getProjectByRepo(provider: RepoProvider, repoId: string): Project | undefined {
  return db.select().from(schema.projects)
    .where(and(eq(schema.projects.repoProvider, provider), eq(schema.projects.repoId, repoId)))
    .get()
}

export function listProjects(): Project[] {
  return db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt)).all()
}

export function getProjects(ids: number[]): Project[] {
  return ids.length ? db.select().from(schema.projects).where(inArray(schema.projects.id, ids)).all() : []
}

export function projectChanged(id: number): void {
  emitTopics(liveTopics.projects, liveTopics.project(id))
}

export function createProject(values: NewProject): Project {
  const project = db.insert(schema.projects).values(values).returning().get()
  projectChanged(project.id)
  return project
}

export function updateProjectConfig(id: number, patch: Partial<NewProject>): Project | undefined {
  const project = db.update(schema.projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.projects.id, id))
    .returning()
    .get()
  projectChanged(id)
  return project
}

export function setProjectDump(id: number, dbDumpPath: string | null): Project | undefined {
  return updateProjectConfig(id, { dbDumpPath, dbImported: false })
}

export function setProjectDbBase(id: number, dbBase: DbBase | null): Project | undefined {
  const project = db.update(schema.projects).set({ dbBase }).where(eq(schema.projects.id, id)).returning().get()
  projectChanged(id)
  return project
}

// False when a newer build or a removed dump has replaced the one that finished.
export function finishProjectDbBase(id: number, builder: string, dbBase: DbBase): boolean {
  const updated = db.update(schema.projects)
    .set({ dbBase })
    .where(and(eq(schema.projects.id, id), sql`json_extract(${schema.projects.dbBase}, '$.builder') = ${builder}`))
    .returning({ id: schema.projects.id })
    .all()
  projectChanged(id)
  return updated.length > 0
}

export function listBuildingDbBases(): { id: number, builder: string }[] {
  return listProjects().flatMap(p => p.dbBase?.state === 'building' ? [{ id: p.id, builder: p.dbBase.builder }] : [])
}

export function setProjectMeta(id: number, meta: ProjectMeta): void {
  db.update(schema.projects).set(meta).where(eq(schema.projects.id, id)).run()
  projectChanged(id)
}

export function clearStarterWorkflow(workflowId: number, tx: Executor = db): void {
  const cleared = tx.update(schema.projects)
    .set({ starterWorkflowId: null })
    .where(eq(schema.projects.starterWorkflowId, workflowId))
    .returning({ id: schema.projects.id })
    .all()
  for (const { id } of cleared) projectChanged(id)
}

// FKs are declarative only (PRAGMA foreign_keys is off), so every table is cleared explicitly.
export function deleteProjectCascade(id: number, sessionIds: number[]): void {
  db.transaction((tx) => {
    if (sessionIds.length) {
      deleteRunSteps(listProjectRunIds(id, tx), tx)
      deleteAgentItems({ sessionIds }, tx)
      deleteFollowups({ sessionIds }, tx)
      deleteProjectRuns(id, tx)
      deleteProjectSessions(id, tx)
    }
    removeProjectFromTriggers(id, tx)
    deleteProjectLinks(id, tx)
    tx.delete(schema.projects).where(eq(schema.projects.id, id)).run()
  })
  projectChanged(id)
}
