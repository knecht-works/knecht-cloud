import { sql } from 'drizzle-orm'
import { db, schema } from '../db'
import { handBackObject } from '../integrations/assignee'
import { getProject } from '../stores/projects'
import { getSessionRow } from '../stores/sessions'
import { appendRunLog, failInterruptedRuns } from '../stores/runs'

export default defineNitroPlugin(() => {
  const interrupted = failInterruptedRuns('\n✗ Interrupted by a daemon restart\n')

  db.update(schema.runSteps)
    .set({
      status: 'failed',
      error: 'Interrupted by a daemon restart',
      finishedAt: new Date(),
    })
    .where(sql`${schema.runSteps.status} = 'running'`)
    .run()

  db.update(schema.followups)
    .set({
      status: 'failed',
      error: 'Interrupted by a daemon restart',
      finishedAt: new Date(),
    })
    .where(sql`${schema.followups.status} = 'running'`)
    .run()

  for (const run of interrupted) {
    const session = getSessionRow(run.sessionId)
    const project = session && getProject(session.projectId)
    if (session && project) void handBackObject(session, run.id, project, text => appendRunLog(run.id, text))
  }
})
