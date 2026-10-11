import type { Project, Session } from '../db/schema'
import { describeObject, sessionHasActiveWork, sessionObject, type SessionObject } from '../utils/sessions'
import { getIntegration } from '.'
import type { Integration } from './types'
import { getRun, latestSessionActor, updateRun } from '../stores/runs'

type Log = (text: string) => void
type Assignee = NonNullable<Integration['capabilities']['assignee']>

function held(session: Session): { assignee: Assignee, object: SessionObject } | null {
  const object = sessionObject(session)
  const assignee = object && getIntegration(object.integration).capabilities.assignee
  return assignee ? { assignee, object } : null
}

// A run started by hand, or by a change the agent itself made on the object, has no actor:
// whoever held the object before Knecht gets it back, or whoever gave it to Knecht last.
export async function takeObject(session: Session, runId: number, project: Project, log: Log): Promise<void> {
  const target = held(session)
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

export async function handBackObject(session: Session, runId: number, project: Project, log: Log): Promise<void> {
  const target = held(session)
  if (!target || sessionHasActiveWork(session.id)) return
  try {
    log(`${await target.assignee.handBack(project, target.object, getRun(runId)?.actor ?? null)}\n`)
  }
  catch (e) {
    log(`Could not hand back ${describeObject(target.object)}: ${(e as Error).message}\n`)
  }
}
