import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { teardownSession } from '../daemon/envs'
import { cancelFollowupWork } from '../daemon/followups'
import { cancelRun } from '../daemon/runner'
import { projectMemoryDir } from './agent-memory'
import { dataDir, projectSharedDir, sessionArchiveDir } from './storage'
import { removeAttachments } from './attachments'

// FKs are declarative only (PRAGMA foreign_keys is off), so every table is cleared explicitly.
export function deleteProject(id: number): Promise<void> {
  const sessionIds = db.select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(eq(schema.sessions.projectId, id))
    .all()
    .map(s => s.id)
  const runningRuns = db.select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.projectId, id), eq(schema.runs.kind, 'workflow'), eq(schema.runs.status, 'running')))
    .all()

  for (const run of runningRuns) cancelRun(run.id)
  for (const sessionId of sessionIds) cancelFollowupWork(sessionId)

  const triggers = db.select({ id: schema.triggers.id, projectIds: schema.triggers.projectIds })
    .from(schema.triggers)
    .all()
    .filter(t => t.projectIds.includes(id))

  if (sessionIds.length) {
    removeAttachments(db.select({ id: schema.followups.id }).from(schema.followups).where(inArray(schema.followups.sessionId, sessionIds)).all().map(f => f.id))
  }
  db.transaction((tx) => {
    if (sessionIds.length) {
      const runIds = tx.select({ id: schema.runs.id }).from(schema.runs).where(eq(schema.runs.projectId, id)).all().map(r => r.id)
      if (runIds.length) tx.delete(schema.runSteps).where(inArray(schema.runSteps.runId, runIds)).run()
      tx.delete(schema.agentItems).where(inArray(schema.agentItems.sessionId, sessionIds)).run()
      tx.delete(schema.followups).where(inArray(schema.followups.sessionId, sessionIds)).run()
      tx.delete(schema.runs).where(eq(schema.runs.projectId, id)).run()
      tx.delete(schema.sessions).where(eq(schema.sessions.projectId, id)).run()
    }
    for (const t of triggers) {
      tx.update(schema.triggers)
        .set({ projectIds: t.projectIds.filter(p => p !== id) })
        .where(eq(schema.triggers.id, t.id))
        .run()
    }
    tx.delete(schema.projectLinks).where(eq(schema.projectLinks.projectId, id)).run()
    tx.delete(schema.projects).where(eq(schema.projects.id, id)).run()
  })

  return cleanupFiles(id, sessionIds).catch((e) => {
    console.error(`[projects] cleanup after disconnecting project ${id} failed (the GC picks up the rest):`, (e as Error).message)
  })
}

// Sequential on purpose: ddev does not take parallel deletes well.
async function cleanupFiles(projectId: number, sessionIds: number[]): Promise<void> {
  for (const sessionId of sessionIds) {
    await teardownSession(sessionId)
    rmSync(sessionArchiveDir(sessionId), { recursive: true, force: true })
  }
  // Not projectDumpDir(): that one mkdirs the folder it names.
  for (const dir of [join(dataDir(), 'dumps', String(projectId)), projectSharedDir(projectId), projectMemoryDir(projectId)]) {
    rmSync(dir, { recursive: true, force: true })
  }
}
