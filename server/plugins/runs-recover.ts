import { sql } from 'drizzle-orm'
import { db, schema } from '../db'

export default defineNitroPlugin(() => {
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
})
