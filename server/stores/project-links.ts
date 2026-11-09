import { and, eq, isNull, ne, or } from 'drizzle-orm'
import { db, schema, type Executor } from '../db'
import type { Project } from '../db/schema'
import type { IntegrationId } from '../../shared/utils/integrations'
import { liveTopics } from '../../shared/utils/live-topics'
import { emitTopics } from '../utils/live'

export type ProjectLinks = Partial<Record<IntegrationId, string>>
export type ProjectLinkNames = Partial<Record<IntegrationId, string>>

export function projectLinks(projectId: number): ProjectLinks {
  return linksOf(db.select().from(schema.projectLinks).where(eq(schema.projectLinks.projectId, projectId)).all())
}

export function withLinks<T extends Project>(projects: T[]): (T & { links: ProjectLinks, linkNames: ProjectLinkNames })[] {
  const rows = db.select().from(schema.projectLinks).all()
  return projects.map((p) => {
    const own = rows.filter(r => r.projectId === p.id)
    const linkNames = Object.fromEntries(own.flatMap(r => r.externalName ? [[r.integration, r.externalName]] : []))
    return { ...p, links: linksOf(own), linkNames }
  })
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

export function setProjectLink(projectId: number, integration: IntegrationId, externalKey: string | null, externalName: string | null = null): void {
  if (externalKey === null) {
    db.delete(schema.projectLinks)
      .where(and(eq(schema.projectLinks.projectId, projectId), eq(schema.projectLinks.integration, integration)))
      .run()
  }
  else {
    db.insert(schema.projectLinks)
      .values({ projectId, integration, externalKey, externalName })
      .onConflictDoUpdate({ target: [schema.projectLinks.projectId, schema.projectLinks.integration], set: { externalKey, externalName } })
      .run()
  }
  emitTopics(liveTopics.projects, liveTopics.project(projectId))
}

// A tracker-side rename reaches the stored names whenever the target list is fetched anyway.
export function refreshLinkNames(integration: IntegrationId, targets: { key: string, name: string }[]): void {
  const changed: number[] = []
  for (const { key, name } of targets) {
    const rows = db.update(schema.projectLinks)
      .set({ externalName: name })
      .where(and(
        eq(schema.projectLinks.integration, integration),
        eq(schema.projectLinks.externalKey, key),
        or(isNull(schema.projectLinks.externalName), ne(schema.projectLinks.externalName, name)),
      ))
      .returning({ projectId: schema.projectLinks.projectId })
      .all()
    changed.push(...rows.map(r => r.projectId))
  }
  if (changed.length) emitTopics(liveTopics.projects, ...changed.map(id => liveTopics.project(id)))
}

export function deleteProjectLinks(projectId: number, tx: Executor = db): void {
  tx.delete(schema.projectLinks).where(eq(schema.projectLinks.projectId, projectId)).run()
  emitTopics(liveTopics.projects, liveTopics.project(projectId))
}
