import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { deleteEnv } from '#server/daemon/envs'
import { dropDbBase } from '#server/daemon/db-base'
import { cancelFollowupWork } from '#server/daemon/followups'
import { cancelRun } from '#server/daemon/runner'
import { projectMemoryDir } from '#server/utils/agent-memory'
import { dataDir, projectSharedDir } from '#server/utils/storage'
import { removeAttachments } from '#server/utils/attachments'
import { deleteProjectCascade } from '#server/stores/projects'
import { listSessionIds } from '#server/stores/sessions'
import { listRunningWorkflowRunIds } from '#server/stores/runs'
import { listFollowupIds } from '#server/stores/followups'

export function deleteProject(id: number): Promise<void> {
  const sessionIds = listSessionIds(id)
  for (const runId of listRunningWorkflowRunIds(id)) cancelRun(runId)
  for (const sessionId of sessionIds) cancelFollowupWork(sessionId)

  removeAttachments(listFollowupIds({ sessionIds }))
  dropDbBase(id)
  deleteProjectCascade(id, sessionIds)

  return cleanupFiles(id, sessionIds).catch((e) => {
    console.error(`[projects] cleanup after disconnecting project ${id} failed (the GC picks up the rest):`, (e as Error).message)
  })
}

// Sequential on purpose: ddev does not take parallel deletes well.
async function cleanupFiles(projectId: number, sessionIds: number[]): Promise<void> {
  for (const sessionId of sessionIds) {
    await deleteEnv(sessionId)
  }
  // Not projectDumpDir(): that one mkdirs the folder it names.
  for (const dir of [join(dataDir(), 'dumps', String(projectId)), projectSharedDir(projectId), projectMemoryDir(projectId)]) {
    rmSync(dir, { recursive: true, force: true })
  }
}
