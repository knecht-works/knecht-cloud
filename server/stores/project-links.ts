import { and, eq } from 'drizzle-orm'
import { db, schema, type Executor } from '../db'
import type { Project } from '../db/schema'
import type { IntegrationId } from '../../shared/utils/integrations'
import { liveTopics } from '../../shared/utils/live-topics'
import { emitTopics } from '../utils/live'

export type ProjectLinks = Partial<Record<IntegrationId, string>>

export function projectLinks(projectId: number): ProjectLinks {
  return linksOf(db.select().from(schema.projectLinks).where(eq(schema.projectLinks.projectId, projectId)).all())
}

export function withLinks<T extends Project>(projects: T[]): (T & { links: ProjectLinks })[] {
  const rows = db.select().from(schema.projectLinks).all()
  return projects.map(p => ({ ...p, links: linksOf(rows.filter(r => r.projectId === p.id)) }))
}

function linksOf(rows: { integration: IntegrationId, externalKey: string }[]): ProjectLinks {
  return Object.fromEntries(rows.map(r => [r.integration, r.externalKey]))
}

export function linkedProject(integration: IntegrationId, externalKey: string): Project | undefined {
  return db
    .select({ project: schema.projects })
    .from(schema.projectLinks)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectLinks.projectId))
    .where(and(eq(schema.projectLinks.integration, integration), eq(schema.projectLinks.externalKey, externalKey)))
    .get()?.project
}

export function linkedKeys(integration: IntegrationId): string[] {
  return db.select({ key: schema.projectLinks.externalKey })
    .from(schema.projectLinks)
    .where(eq(schema.projectLinks.integration, integration))
    .all()
    .map(r => r.key)
}

export function setProjectLink(projectId: number, integration: IntegrationId, externalKey: string | null): void {
  if (externalKey === null) {
    db.delete(schema.projectLinks)
      .where(and(eq(schema.projectLinks.projectId, projectId), eq(schema.projectLinks.integration, integration)))
      .run()
  }
  else {
    db.insert(schema.projectLinks)
      .values({ projectId, integration, externalKey })
      .onConflictDoUpdate({ target: [schema.projectLinks.projectId, schema.projectLinks.integration], set: { externalKey } })
      .run()
  }
  emitTopics(liveTopics.projects, liveTopics.project(projectId))
}

export function deleteProjectLinks(projectId: number, tx: Executor = db): void {
  tx.delete(schema.projectLinks).where(eq(schema.projectLinks.projectId, projectId)).run()
  emitTopics(liveTopics.projects, liveTopics.project(projectId))
}
