import { archiveStaleEnvs, reapExpiredArchives, reapIdleEnvs } from '../daemon/envs'

// Environment lifecycle reaper. On a fixed tick it walks envs down the
// retention ladder (daemon/envs.ts):
//   1. stops envs idle longer than `idleStopMinutes` (their DB is exported
//      into the run archive on the way down; the sandbox keeps its filesystem
//      so a preview reboot is quick),
//   2. archives envs stopped longer than `previewRetentionDays` (sandbox +
//      worktree go, the small restore artifacts stay), and
//   3. deletes archives untouched longer than `archiveRetentionDays`.
// All three are operator settings (server/utils/settings.ts).
export default defineNitroPlugin(() => {
  setInterval(() => {
    void reapIdleEnvs()
    void archiveStaleEnvs()
    void reapExpiredArchives()
  }, 60_000)
})
