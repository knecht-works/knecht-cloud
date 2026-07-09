import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { fireTrigger } from '../utils/triggers'
import { TRIGGER_SOURCES } from '../utils/trigger-sources'

// Drives the registry trigger sources (server/utils/trigger-sources/): every
// tick, each source's active triggers are polled and the matches fired. A tick
// with no active registry triggers costs one local DB read and no network.
// State is persisted only after the matches fired, so a failed tick replays
// the diff on the next one instead of losing events. Errors are isolated per
// trigger: one unreachable source doesn't stall the others.

const TICK_MS = 45_000

let ticking = false

async function tick(): Promise<void> {
  // The interval keeps firing while a slow tick is still awaiting Jira;
  // overlapping ticks would double-fire the same diff.
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
            // fireTrigger bumps firedCount from the row it was handed; keep the
            // local copy current so several matches in one tick all count.
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
