import { sql } from 'drizzle-orm'
import { db, schema } from '../db'
import { appendLog } from '../daemon/runner'
import { handBackObject } from '../integrations/assignee'
import { getProject, getSessionRow } from '../utils/entities'

export default defineNitroPlugin(() => {
  const interrupted = db.select({ id: schema.runs.id, sessionId: schema.runs.sessionId })
    .from(schema.runs)
    .where(sql`${schema.runs.status} = 'running'`)
    .all()
  db.update(schema.runs)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      log: sql`${schema.runs.log} || '\n✗ Interrupted by a daemon restart\n'`,
    })
    .where(sql`${schema.runs.status} = 'running'`)
    .run()

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
    if (session && project) void handBackObject(session, run.id, project, text => appendLog(run.id, text))
  }
})
