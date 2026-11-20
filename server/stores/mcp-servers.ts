import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { db, schema, type Executor } from '#server/db'
import type { McpServer } from '#server/db/schema'

export type NewMcpServer = typeof schema.mcpServers.$inferInsert

export function listMcpServers(projectId: number | null): McpServer[] {
  return db.select().from(schema.mcpServers)
    .where(projectId === null ? isNull(schema.mcpServers.projectId) : eq(schema.mcpServers.projectId, projectId))
    .orderBy(asc(schema.mcpServers.name))
    .all()
}

export function effectiveMcpServers(projectId: number): McpServer[] {
  const rows = db.select().from(schema.mcpServers)
    .where(or(isNull(schema.mcpServers.projectId), eq(schema.mcpServers.projectId, projectId)))
    .orderBy(asc(schema.mcpServers.name))
    .all()
  const byName = new Map<string, McpServer>()
  for (const row of rows) {
    if (row.projectId === null && byName.has(row.name)) continue
    byName.set(row.name, row)
  }
  return [...byName.values()].filter(row => row.enabled)
}

export function getMcpServer(id: number): McpServer | undefined {
  return db.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, id)).get()
}

export function mcpNameTaken(projectId: number | null, name: string, exceptId?: number): boolean {
  const row = db.select({ id: schema.mcpServers.id }).from(schema.mcpServers)
    .where(and(
      projectId === null ? isNull(schema.mcpServers.projectId) : eq(schema.mcpServers.projectId, projectId),
      eq(schema.mcpServers.name, name),
    ))
    .get()
  return !!row && row.id !== exceptId
}

export function insertMcpServer(values: NewMcpServer): McpServer {
  return db.insert(schema.mcpServers).values(values).returning().get()
}

export function updateMcpServer(id: number, patch: Partial<Omit<NewMcpServer, 'id' | 'projectId'>>): McpServer | undefined {
  return db.update(schema.mcpServers)
    .set({ ...patch, updatedAt: sql`(unixepoch())` })
    .where(eq(schema.mcpServers.id, id))
    .returning()
    .get()
}

export function deleteMcpServer(id: number): void {
  db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, id)).run()
}

export function deleteProjectMcpServers(projectId: number, tx: Executor = db): void {
  tx.delete(schema.mcpServers).where(eq(schema.mcpServers.projectId, projectId)).run()
}
