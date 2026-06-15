import { and, eq, isNotNull, lte } from 'drizzle-orm'
import { db, schema } from '../db'
import { nextRun } from '../utils/cron'
import { fireTrigger } from '../utils/triggers'

// Fires due schedule triggers. On each tick it finds active schedule triggers
// whose next fire has passed, fires them (one run per attached project) and
// recomputes the next fire from the cron expression. Catch-up is intentional:
// a trigger that came due while the daemon was down fires once on the next tick,
// not once per missed slot. `nextFireAt` is seeded on create/edit; this advances
// it. The 30s tick bounds how late a fire can be.
export default defineNitroPlugin(() => {
  setInterval(() => {
    const due = db
      .select()
      .from(schema.triggers)
      .where(and(
        eq(schema.triggers.source, 'schedule'),
        eq(schema.triggers.active, true),
        isNotNull(schema.triggers.nextFireAt),
        lte(schema.triggers.nextFireAt, new Date()),
      ))
      .all()

    for (const t of due) {
      try {
        fireTrigger(t)
      }
      catch (e) {
        console.error(`Trigger ${t.id} failed to fire:`, (e as Error).message)
      }
      const next = t.cron ? nextRun(t.cron) : null
      db.update(schema.triggers).set({ nextFireAt: next }).where(eq(schema.triggers.id, t.id)).run()
    }
  }, 30_000)
})
