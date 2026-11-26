import { hasRunningWork } from '#server/daemon/dispatcher'
import { startUpdate } from '#server/daemon/update'
import { getSettings } from '#server/utils/settings'
import { isValidCron, nextRun } from '#server/utils/cron'
import { availableUpdate } from '#server/utils/version'
import { defineNitroPlugin } from 'nitropack/runtime'

let lastCron = ''
let nextFireAt: Date | null = null
let due = false
let attempted: string | null = null

async function tick(): Promise<void> {
  const cron = getSettings().autoUpdateCron.trim()
  if (cron !== lastCron) {
    lastCron = cron
    due = false
    if (cron && !isValidCron(cron)) {
      console.error(`[auto-update] invalid cron '${cron}', automatic updates are off`)
      nextFireAt = null
    }
    else {
      nextFireAt = cron ? nextRun(cron) : null
    }
  }
  if (!cron) return
  if (nextFireAt && nextFireAt <= new Date()) {
    due = true
    nextFireAt = nextRun(cron)
  }
  if (!due) return

  const latest = await availableUpdate()
  if (!latest || attempted === latest) {
    due = false
    return
  }
  if (hasRunningWork()) return
  due = false
  attempted = latest
  console.log(`[auto-update] starting update to ${latest}`)
  await startUpdate(latest)
}

export default defineNitroPlugin(() => {
  setInterval(() => {
    tick().catch(err => console.error('[auto-update] tick failed:', err))
  }, 60_000)
})
