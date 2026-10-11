import { rmSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { db, schema } from '../../db'
import { teardownSession } from '../../daemon/envs'
import { cancelFollowupWork } from '../../daemon/followups'
import { cancelRun } from '../../daemon/runner'
import { sessionArchiveDir } from '../../utils/storage'
import { removeAttachments } from '../../utils/attachments'
import { deleteSession } from '../../stores/sessions'
import { getRun, sessionHasRuns, deleteRun } from '../../stores/runs'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = getRun(id)
  if (!run) {
    return { ok: true }
  }

  // Abort before deleting rows, or the runner races the delete and recreates
  // the sandbox for a row that no longer exists.
  if (run.kind === 'mention') cancelFollowupWork(run.sessionId, id)
  else cancelRun(id)

  // FKs are declarative only (PRAGMA foreign_keys off): clean up explicitly.
  db.delete(schema.runSteps).where(eq(schema.runSteps.runId, id)).run()
  const followupIds = db.select({ id: schema.followups.id }).from(schema.followups).where(eq(schema.followups.runId, id)).all().map(f => f.id)
  if (followupIds.length) db.delete(schema.agentItems).where(inArray(schema.agentItems.followupId, followupIds)).run()
  removeAttachments(followupIds)
  db.delete(schema.followups).where(eq(schema.followups.runId, id)).run()
  deleteRun(id)

  if (!sessionHasRuns(run.sessionId)) {
    await teardownSession(run.sessionId)
    rmSync(sessionArchiveDir(run.sessionId), { recursive: true, force: true })
    db.delete(schema.agentItems).where(eq(schema.agentItems.sessionId, run.sessionId)).run()
    removeAttachments(db.select({ id: schema.followups.id }).from(schema.followups).where(eq(schema.followups.sessionId, run.sessionId)).all().map(f => f.id))
    db.delete(schema.followups).where(eq(schema.followups.sessionId, run.sessionId)).run()
    deleteSession(run.sessionId)
  }
  return { ok: true }
})
