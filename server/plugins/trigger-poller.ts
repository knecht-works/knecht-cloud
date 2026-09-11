import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { fireTrigger } from '../utils/triggers'
import { TRIGGER_SOURCES } from '../utils/trigger-sources'

// Persist state only after the matches fired, so a failed tick replays the diff.

const TICK_MS = 45_000

let ticking = false

async function tick(): Promise<void> {
  // Overlapping ticks would double-fire the same diff.
  if (ticking) return
  ticking = true
  try {
    for (const def of TRIGGER_SOURCES) {
      const rows = db
        .select()
        .from(schema.triggers)
        .where(and(eq(schema.triggers.source, def.source), eq(schema.triggers.active, true)))
        .all()

      for (const trigger of rows) {
        try {
          const { matches, state } = await def.poll(trigger)
          let firedCount = trigger.firedCount
          for (const match of matches) {
            fireTrigger({ ...trigger, firedCount }, { branch: match.branch, inputs: match.inputs })
            firedCount += 1
          }
          if (JSON.stringify(state) !== JSON.stringify(trigger.state)) {
            db.update(schema.triggers).set({ state }).where(eq(schema.triggers.id, trigger.id)).run()
          }
        }
        catch (e) {
          console.error(`${def.source} trigger ${trigger.id} failed to poll:`, (e as Error).message)
        }
      }
    }
  }
  finally {
    ticking = false
  }
}

export default defineNitroPlugin(() => {
  setInterval(() => {
    void tick()
  }, TICK_MS)
})
