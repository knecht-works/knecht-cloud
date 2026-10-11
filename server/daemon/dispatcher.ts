import { startRun } from './runner'
import { startFollowup } from './followups'
import { getSettings } from '../utils/settings'
import { listRunningRunSessionIds, listQueuedWorkflowRuns } from '../stores/runs'
import { listRunningFollowupSessionIds, listQueuedFollowups } from '../stores/followups'

// Started but maybe not yet 'running': guards against double-starting across ticks.
const active = new Map<number, number>()
const activeFollowups = new Map<number, number>()

function busySessions(): Set<number> {
  const busy = new Set<number>([...active.values(), ...activeFollowups.values()])
  for (const sessionId of listRunningRunSessionIds()) busy.add(sessionId)
  for (const sessionId of listRunningFollowupSessionIds()) busy.add(sessionId)
  return busy
}

export function hasRunningWork(): boolean {
  return busySessions().size > 0
}

export function dispatchRuns(): void {
  const queued = listQueuedWorkflowRuns().filter(({ run }) => !active.has(run.id))

  const busy = busySessions()
  let capacity = Math.max(1, getSettings().maxConcurrentRuns) - active.size - activeFollowups.size
  for (const { run, project } of queued) {
    if (capacity <= 0) break
    if (busy.has(run.sessionId)) continue
    busy.add(run.sessionId)
    active.set(run.id, run.sessionId)
    startRun(run.id, project).finally(() => {
      active.delete(run.id)
      dispatchRuns()
    })
    capacity--
  }

  // A mention's starter run must boot the env before the mention prompt runs.
  for (const { run } of queued) {
    if (!active.has(run.id)) busy.add(run.sessionId)
  }
  const queuedFollowups = listQueuedFollowups().filter(f => !activeFollowups.has(f.id))
  for (const { id, sessionId } of queuedFollowups) {
    if (capacity <= 0) break
    if (busy.has(sessionId)) continue
    busy.add(sessionId)
    activeFollowups.set(id, sessionId)
    startFollowup(id).finally(() => {
      activeFollowups.delete(id)
      dispatchRuns()
    })
    capacity--
  }
}
