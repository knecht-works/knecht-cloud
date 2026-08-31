import { reconcileEnvStates } from '../daemon/envs'

// A host reboot kills the containers of 'up' envs; only the knecht stack
// itself auto-restarts. envState is the desired state, so restore it at
// boot: every 'up' env is brought back with `ddev start` (all services,
// add-ons included), and one whose start fails becomes 'stopped', where the
// workspace offers its Reboot button. Stopped/archived envs stay as they
// are. The runs analogue is runs-recover.ts. (Named to sort after
// migrate.ts: Nitro runs plugins alphabetically.)
export default defineNitroPlugin(() => {
  reconcileEnvStates().catch(err => console.error('[reconcile-envs] failed:', err))
})
