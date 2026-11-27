import { deleteEnv } from '#server/daemon/envs'
import { cancelFollowupWork } from '#server/daemon/followups'
import { cancelRun } from '#server/daemon/runner'
import { removeAttachments } from '#server/utils/attachments'
import { deleteSession, getSessionRow } from '#server/stores/sessions'
import { deleteRun, listSessionRunIds } from '#server/stores/runs'
import { deleteRunSteps } from '#server/stores/run-steps'
import { listFollowupIds, deleteFollowups } from '#server/stores/followups'
import { deleteAgentItems } from '#server/stores/agent-items'
import { deleteSessionObjectRows } from '#server/stores/session-objects'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  if (!getSessionRow(id)) {
    return { ok: true }
  }

  // Abort before deleting rows, or the runner races the delete and recreates
  // the sandbox for a row that no longer exists.
  const runIds = listSessionRunIds(id)
  for (const runId of runIds) cancelRun(runId)
  cancelFollowupWork(id)

  // FKs are declarative only (PRAGMA foreign_keys off): clean up explicitly.
  deleteRunSteps(runIds)
  const followupIds = listFollowupIds({ sessionId: id })
  removeAttachments(followupIds)
  deleteAgentItems({ sessionIds: [id] })
  deleteFollowups({ sessionId: id })
  for (const runId of runIds) deleteRun(runId)
  deleteSessionObjectRows(id)
  deleteSession(id)

  // Not awaited: a cancelled boot winds down first, and the session is gone for the dashboard already.
  deleteEnv(id).catch(e => console.error(`[sessions] tearing down deleted session ${id} failed (the GC picks up the rest):`, e))
  return { ok: true }
})
