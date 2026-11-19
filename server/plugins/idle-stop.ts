import { archiveStaleEnvs, reapExpiredArchives, reapIdleEnvs } from '#server/daemon/envs'
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin(() => {
  setInterval(() => {
    void reapIdleEnvs()
    void archiveStaleEnvs()
    void reapExpiredArchives()
  }, 60_000)
})
