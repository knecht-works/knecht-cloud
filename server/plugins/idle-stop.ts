import { reapIdleEnvs, reapStoppedEnvs } from '../daemon/envs'

// Environment lifecycle reaper (architecture.md §5). On a fixed tick it:
//   1. stops envs idle longer than `idleStopMinutes` (frees network + ports,
//      keeps volumes so a preview reboot is quick), and
//   2. fully deletes envs stopped longer than `teardownStoppedMinutes` (reclaims
//      volumes + worktree).
// Both timeouts are operator settings (server/utils/settings.ts); the hard
// concurrency cap is enforced at boot in the runner (enforceEnvCap).
export default defineNitroPlugin(() => {
  setInterval(() => {
    void reapIdleEnvs()
    void reapStoppedEnvs()
  }, 60_000)
})
