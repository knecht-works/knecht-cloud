import { hasRunningWork } from '../daemon/dispatcher'
import { startUpdate } from '../daemon/update'
import { getSettings } from '../utils/settings'
import { isValidCron, nextRun } from '../utils/cron'
import { currentVersion, isNewerVersion, latestVersion } from '../utils/version'

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

  const latest = await latestVersion()
  if (!latest || !isNewerVersion(latest, currentVersion()) || attempted === latest) {
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
