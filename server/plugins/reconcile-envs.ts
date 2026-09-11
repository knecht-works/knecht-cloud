import { reconcileEnvStates } from '../daemon/envs'

// Named to sort after migrate.ts: Nitro runs plugins alphabetically.
export default defineNitroPlugin(() => {
  reconcileEnvStates().catch(err => console.error('[reconcile-envs] failed:', err))
})
