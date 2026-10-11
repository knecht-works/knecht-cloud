import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { teardownSession } from '../daemon/envs'
import { cancelFollowupWork } from '../daemon/followups'
import { cancelRun } from '../daemon/runner'
import { projectMemoryDir } from './agent-memory'
import { dataDir, projectSharedDir, sessionArchiveDir } from './storage'
import { removeAttachments } from './attachments'
import { deleteProjectRow } from '../stores/projects'
import { deleteProjectLinks } from '../stores/project-links'
import { removeProjectFromTriggers } from '../stores/triggers'
import { listSessionIds, deleteProjectSessions } from '../stores/sessions'
import { listRunningWorkflowRunIds, listProjectRunIds, deleteProjectRuns } from '../stores/runs'

// FKs are declarative only (PRAGMA foreign_keys is off), so every table is cleared explicitly.
export function deleteProject(id: number): Promise<void> {
  const sessionIds = listSessionIds(id)
  for (const runId of listRunningWorkflowRunIds(id)) cancelRun(runId)
  for (const sessionId of sessionIds) cancelFollowupWork(sessionId)

  if (sessionIds.length) {
    removeAttachments(db.select({ id: schema.followups.id }).from(schema.followups).where(inArray(schema.followups.sessionId, sessionIds)).all().map(f => f.id))
  }
  db.transaction((tx) => {
    if (sessionIds.length) {
      const runIds = listProjectRunIds(id, tx)
      if (runIds.length) tx.delete(schema.runSteps).where(inArray(schema.runSteps.runId, runIds)).run()
      tx.delete(schema.agentItems).where(inArray(schema.agentItems.sessionId, sessionIds)).run()
      tx.delete(schema.followups).where(inArray(schema.followups.sessionId, sessionIds)).run()
      deleteProjectRuns(id, tx)
      deleteProjectSessions(id, tx)
    }
    removeProjectFromTriggers(id, tx)
    deleteProjectLinks(id, tx)
    deleteProjectRow(id, tx)
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
