import { archiveStaleEnvs, reapExpiredArchives, reapIdleEnvs } from '../daemon/envs'

export default defineNitroPlugin(() => {
  setInterval(() => {
    void reapIdleEnvs()
    void archiveStaleEnvs()
    void reapExpiredArchives()
  }, 60_000)
})
