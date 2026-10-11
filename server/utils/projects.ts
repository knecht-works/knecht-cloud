import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { teardownSession } from '../daemon/envs'
import { cancelFollowupWork } from '../daemon/followups'
import { cancelRun } from '../daemon/runner'
import { projectMemoryDir } from './agent-memory'
import { dataDir, projectSharedDir, sessionArchiveDir } from './storage'
import { removeAttachments } from './attachments'
import { deleteProjectCascade } from '../stores/projects'
import { listSessionIds } from '../stores/sessions'
import { listRunningWorkflowRunIds } from '../stores/runs'
import { listFollowupIds } from '../stores/followups'

export function deleteProject(id: number): Promise<void> {
  const sessionIds = listSessionIds(id)
  for (const runId of listRunningWorkflowRunIds(id)) cancelRun(runId)
  for (const sessionId of sessionIds) cancelFollowupWork(sessionId)

  removeAttachments(listFollowupIds({ sessionIds }))
  deleteProjectCascade(id, sessionIds)

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
