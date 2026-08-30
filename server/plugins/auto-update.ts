import { hasRunningWork } from '../daemon/dispatcher'
import { startUpdate } from '../daemon/update'
import { getSettings } from '../utils/settings'
import { isValidCron, nextRun } from '../utils/cron'
import { currentVersion, isNewerVersion, latestVersion } from '../utils/version'

// Automatic updates: settings.autoUpdateCron (empty = off) schedules when the
// instance installs new releases itself instead of waiting for someone to
// press the button. Each time the schedule fires, an update becomes DUE; a due
// update starts as soon as all guards pass:
//   - a strictly newer stable release exists (dev builds report 'dev' and are
//     never eligible, see utils/version.ts),
//   - no run or follow-up is executing (the update recreates the container;
//     running work would be failed by runs-recover, queued work survives and
//     starts after the restart).
// "Due" persists across ticks, so a run that is busy at the scheduled minute
// only delays the update instead of skipping the whole slot. One attempt per
// target version per process: on success the container is recreated (this
// process dies), on failure the operator investigates via
// `docker logs knecht-updater` instead of the plugin retrying into the same
// wall on every tick.

let lastCron = ''
let nextFireAt: Date | null = null
let due = false
let attempted: string | null = null

async function tick(): Promise<void> {
  const cron = getSettings().autoUpdateCron.trim()
  if (cron !== lastCron) {
    // New or changed schedule: (re)seed the next fire. Invalid expressions
    // (possible via a hand-written env preset) disable the schedule.
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
    // Nothing (new) to install for this slot; the next fire re-arms.
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
