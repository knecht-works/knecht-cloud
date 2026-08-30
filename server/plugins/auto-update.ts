import { hasRunningWork } from '../daemon/dispatcher'
import { startUpdate } from '../daemon/update'
import { getSettings } from '../utils/settings'
import { currentVersion, isNewerVersion, latestVersion } from '../utils/version'

// Automatic updates: when the operator turns settings.autoUpdate on, the
// instance installs new releases itself instead of waiting for someone to
// press the button. Guards, in order:
//   - only inside the night maintenance window (03:00 to 06:00 server time),
//   - only when a strictly newer stable release exists (dev builds report
//     'dev' and are never eligible, see utils/version.ts),
//   - only while no run or follow-up is executing (the update recreates the
//     container; running work would be failed by runs-recover, queued work
//     survives and starts after the restart).
// One attempt per target version per process: on success the container is
// recreated (this process dies), on failure the operator investigates via
// `docker logs knecht-updater` instead of the plugin retrying into the same
// wall every tick.

const WINDOW_START_HOUR = 3
const WINDOW_END_HOUR = 6

let attempted: string | null = null

async function tick(): Promise<void> {
  if (!getSettings().autoUpdate) return
  const hour = new Date().getHours()
  if (hour < WINDOW_START_HOUR || hour >= WINDOW_END_HOUR) return
  const latest = await latestVersion()
  if (!latest || !isNewerVersion(latest, currentVersion()) || attempted === latest) return
  if (hasRunningWork()) return
  attempted = latest
  console.log(`[auto-update] starting update to ${latest}`)
  await startUpdate(latest)
}

export default defineNitroPlugin(() => {
  setInterval(() => {
    tick().catch(err => console.error('[auto-update] tick failed:', err))
  }, 10 * 60_000)
})
