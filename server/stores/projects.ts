import { desc, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import { db, schema, type Executor } from '../db'
import type { NewProject, Project } from '../db/schema'
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

export function getProjectByGithubId(githubId: number): Project | undefined {
  return db.select().from(schema.projects).where(eq(schema.projects.githubId, githubId)).get()
}

export function listProjects(): Project[] {
  return db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt)).all()
}

export function getProjects(ids: number[]): Project[] {
  return ids.length ? db.select().from(schema.projects).where(inArray(schema.projects.id, ids)).all() : []
}

export function createProject(values: NewProject): Project {
  return db.insert(schema.projects).values(values).returning().get()
}

export function updateProjectConfig(id: number, patch: Partial<NewProject>): Project | undefined {
  return db.update(schema.projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.projects.id, id))
    .returning()
    .get()
}

export function setProjectDump(id: number, dbDumpPath: string | null): Project | undefined {
  return updateProjectConfig(id, { dbDumpPath, dbImported: false })
}

export function setProjectMeta(id: number, meta: ProjectMeta): void {
  db.update(schema.projects).set(meta).where(eq(schema.projects.id, id)).run()
}

export function clearStarterWorkflow(workflowId: number, tx: Executor = db): void {
  tx.update(schema.projects).set({ starterWorkflowId: null }).where(eq(schema.projects.starterWorkflowId, workflowId)).run()
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
}
