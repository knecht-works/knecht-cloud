import { sql } from 'drizzle-orm'
import { db, schema } from '../db'

// No mid-run resume in the MVP (tech-stack.md §4): any run still 'running' or
// 'queued' when the daemon boots was interrupted by a restart — mark it failed.
export default defineNitroPlugin(() => {
  db.update(schema.runs)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      log: sql`${schema.runs.log} || '\n✗ Interrupted by a daemon restart\n'`,
    })
    .where(sql`${schema.runs.status} in ('running', 'queued')`)
    .run()
})
