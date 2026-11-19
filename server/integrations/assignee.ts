import type { Project, Session } from '#server/db/schema'
import { describeObject, sessionHasActiveWork, sessionObjectsWithIds, workObject, type SessionObject } from '#server/utils/sessions'
import { getIntegration } from '.'
import type { CommentAuthor, Integration } from '#server/integrations/types'
import { getRun, latestObjectActor, latestSessionActor, updateRun } from '#server/stores/runs'

type Log = (text: string) => void
type Assignee = NonNullable<Integration['capabilities']['assignee']>

// The object the run works on: a review on the PR leaves the ticket with whoever holds it.
function held(session: Session, runId: number): { assignee: Assignee, object: SessionObject } | null {
  const object = workObject(session.id, getRun(runId)?.objectId)
  const assignee = object && getIntegration(object.integration).capabilities.assignee
  return assignee ? { assignee, object } : null
}

// A run started by hand, or by a change the agent itself made on the object, has no actor:
// whoever held the object before Knecht gets it back, or whoever gave it to Knecht last.
export async function takeObject(session: Session, runId: number, project: Project, log: Log): Promise<void> {
  const target = held(session, runId)
  if (!target) return
  try {
    const previous = await target.assignee.take(project, target.object)
    if (!getRun(runId)?.actor) {
      const actor = previous ?? latestSessionActor(session.id)
      if (actor) updateRun(runId, { actor })
    }
    log(`Knecht holds ${describeObject(target.object)} while it works\n`)
  }
  catch (e) {
    log(`Could not take ${describeObject(target.object)}: ${(e as Error).message}\n`)
  }
}

// Once the session's last work ends Knecht lets go of every object, also one an earlier run took:
// a review on the PR must not leave the ticket with Knecht. Answers who holds the run's own object.
export async function handBackObject(session: Session, runId: number, project: Project, log: Log): Promise<CommentAuthor | null> {
  if (sessionHasActiveWork(session.id)) return null
  const run = getRun(runId)
  const work = workObject(session.id, run?.objectId)
  let holder: CommentAuthor | null = null
  for (const { id, object } of sessionObjectsWithIds(session.id)) {
    const assignee = getIntegration(object.integration).capabilities.assignee
    if (!assignee) continue
    const own = work?.integration === object.integration && work.key === object.key
    try {
      const result = await assignee.handBack(project, object, own ? run?.actor ?? null : latestObjectActor(session.id, id))
      log(`${result.summary}\n`)
      if (own) holder = result.holder
    }
    catch (e) {
      log(`Could not hand back ${describeObject(object)}: ${(e as Error).message}\n`)
    }
  }
  return holder
}
