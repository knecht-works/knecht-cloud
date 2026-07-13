import { sql } from 'drizzle-orm'
import { db, schema } from '../db'

// No automatic mid-run resume: any run still 'running' when the daemon boots
// was interrupted by a restart; mark it failed (a manual retry resumes it from
// the interrupted step, see /api/runs/:id/retry). 'queued' runs are left
// alone: the queue is crash-safe, the dispatcher
// (server/plugins/dispatcher.ts) picks them up once it starts ticking.
export default defineNitroPlugin(() => {
  db.update(schema.runs)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      log: sql`${schema.runs.log} || '\n✗ Interrupted by a daemon restart\n'`,
    })
    .where(sql`${schema.runs.status} = 'running'`)
    .run()

  // The interrupted run's in-flight step stays 'running' in run_steps, so close
  // it out so the step timeline shows exactly where the run was cut off.
  db.update(schema.runSteps)
    .set({
      status: 'failed',
      error: 'Interrupted by a daemon restart',
      finishedAt: new Date(),
    })
    .where(sql`${schema.runSteps.status} = 'running'`)
    .run()

  // Same for follow-ups: a 'running' one died with the process ('queued' ones
  // are crash-safe, the dispatcher picks them up again).
  db.update(schema.followups)
    .set({
      status: 'failed',
      error: 'Interrupted by a daemon restart',
      finishedAt: new Date(),
    })
    .where(sql`${schema.followups.status} = 'running'`)
    .run()
})
