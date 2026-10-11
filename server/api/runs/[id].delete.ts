import { rmSync } from 'node:fs'
import { teardownSession } from '../../daemon/envs'
import { cancelFollowupWork } from '../../daemon/followups'
import { cancelRun } from '../../daemon/runner'
import { sessionArchiveDir } from '../../utils/storage'
import { removeAttachments } from '../../utils/attachments'
import { deleteSession } from '../../stores/sessions'
import { getRun, sessionHasRuns, deleteRun } from '../../stores/runs'
import { deleteRunSteps } from '../../stores/run-steps'
import { listFollowupIds, deleteFollowups } from '../../stores/followups'
import { deleteAgentItems } from '../../stores/agent-items'

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
  deleteRunSteps([id])
  const followupIds = listFollowupIds({ runId: id })
  deleteAgentItems({ followupIds })
  removeAttachments(followupIds)
  deleteFollowups({ runId: id })
  deleteRun(id)

  if (!sessionHasRuns(run.sessionId)) {
    await teardownSession(run.sessionId)
    rmSync(sessionArchiveDir(run.sessionId), { recursive: true, force: true })
    deleteAgentItems({ sessionIds: [run.sessionId] })
    removeAttachments(listFollowupIds({ sessionId: run.sessionId }))
    deleteFollowups({ sessionId: run.sessionId })
    deleteSession(run.sessionId)
  }
  return { ok: true }
})
