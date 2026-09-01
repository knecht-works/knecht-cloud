import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db'
import { teardownSession } from '../daemon/envs'
import { cancelFollowupWork } from '../daemon/followups'
import { cancelRun } from '../daemon/runner'
import { projectMemoryDir } from './agent-memory'
import { dataDir, projectSharedDir, sessionArchiveDir } from './storage'

// Disconnect a project: everything Knecht holds for it goes, the GitHub repo
// itself is never touched. Two phases:
//
//   1. Synchronous: stop the work executing for it, then drop every row
//      (sessions, runs, steps, follow-ups, the trigger references, the
//      project) in one transaction. The FKs are declarative only (PRAGMA
//      foreign_keys is off), so each table is cleared explicitly. After this
//      the project is gone from every view and the dispatcher can claim
//      nothing more for it (it joins runs on projects).
//   2. In the background (the returned promise; the API route does not await
//      it): the per-session envs, checkouts and archives plus the project's
//      dump/shared/memory dirs. Slow (one `ddev delete` per session), and
//      safe to leave unattended: nothing references it anymore, so whatever
//      a crash or an unreachable docker leaves behind, the reconcile GC
//      (daemon/gc.ts) reclaims on its next tick.
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

  // A queued workflow run needs no cancel: once its project row is gone the
  // dispatcher never claims it. A running one is aborted through its
  // controller; mention runs are driven by the follow-up executor instead.
  for (const run of runningRuns) cancelRun(run.id)
  for (const sessionId of sessionIds) cancelFollowupWork(sessionId)

  const triggers = db.select({ id: schema.triggers.id, projectIds: schema.triggers.projectIds })
    .from(schema.triggers)
    .all()
    .filter(t => t.projectIds.includes(id))

  db.transaction((tx) => {
    if (sessionIds.length) {
      const runIds = tx.select({ id: schema.runs.id }).from(schema.runs).where(eq(schema.runs.projectId, id)).all().map(r => r.id)
      if (runIds.length) tx.delete(schema.runSteps).where(inArray(schema.runSteps.runId, runIds)).run()
      tx.delete(schema.followups).where(inArray(schema.followups.sessionId, sessionIds)).run()
      tx.delete(schema.runs).where(eq(schema.runs.projectId, id)).run()
      tx.delete(schema.sessions).where(eq(schema.sessions.projectId, id)).run()
    }
    // The trigger itself stays (the user may point it at another project);
    // only the dead reference goes.
    for (const t of triggers) {
      tx.update(schema.triggers)
        .set({ projectIds: t.projectIds.filter(p => p !== id) })
        .where(eq(schema.triggers.id, t.id))
        .run()
    }
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
