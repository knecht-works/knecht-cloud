import { listDueScheduleTriggers, setTriggerNextFire } from '../stores/triggers'
import { nextRun } from '../utils/cron'
import { fireTrigger } from '../utils/triggers'

export default defineNitroPlugin(() => {
  setInterval(() => {
    const due = listDueScheduleTriggers(new Date())

    for (const t of due) {
      try {
        fireTrigger(t)
      }
      catch (e) {
        console.error(`Trigger ${t.id} failed to fire:`, (e as Error).message)
      }
      const next = t.cron ? nextRun(t.cron) : null
      setTriggerNextFire(t.id, next)
    }
  }, 30_000)
})
