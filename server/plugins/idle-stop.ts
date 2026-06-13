import { execa } from 'execa'
import { and, eq, lt } from 'drizzle-orm'
import { db, schema } from '../db'
import { runEnvName } from '../utils/storage'

// Idle cooldown (architecture.md §5): a run's environment stays up after the
// run so it can be previewed, but is stopped once it has been quiet (no preview
// access) longer than the idle timeout. `ddev stop` keeps the volumes, so the
// env can be rebooted quickly later without re-importing the DB.
const IDLE_MINUTES = Number(process.env.KNECHT_IDLE_MINUTES || 30)

export default defineNitroPlugin(() => {
  setInterval(() => void reapIdleEnvs(), 60_000)
})

async function reapIdleEnvs(): Promise<void> {
  const cutoff = new Date(Date.now() - IDLE_MINUTES * 60_000)
  const idle = db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.envState, 'up'), lt(schema.runs.previewLastSeen, cutoff)))
    .all()

  for (const { id } of idle) {
    try {
      await execa('ddev', ['stop', runEnvName(id)])
      db.update(schema.runs).set({ envState: 'stopped' }).where(eq(schema.runs.id, id)).run()
    }
    catch {
      // Leave envState as-is; we'll retry on the next tick.
    }
  }
}
