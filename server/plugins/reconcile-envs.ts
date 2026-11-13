import { reconcileEnvStates } from '../daemon/envs'
import { failInterruptedDbBases } from '../daemon/db-base'

// Named to sort after migrate.ts: Nitro runs plugins alphabetically.
export default defineNitroPlugin(() => {
  reconcileEnvStates().catch(err => console.error('[reconcile-envs] failed:', err))
  failInterruptedDbBases().catch(err => console.error('[reconcile-envs] db bases failed:', err))
})
