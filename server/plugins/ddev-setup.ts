import { execa } from 'execa'

// Ensure ddev's shared router is omitted (also baked into the image — Dockerfile).
// The router is the only component that binds fixed HOST ports, so it's the sole
// source of host-port collisions when many isolated run envs (or clones of the
// same repo) boot at once. Knecht reaches each run's web container directly over
// the `ddev_default` network (dood-harness.md §7), so it never needs the router;
// omitting it makes `ddev start` immune to port conflicts and lets any number of
// previews coexist regardless of the ports a project declares.
//
// Gated on KNECHT_MANAGED_DDEV (set by docker-compose): only the Knecht container
// owns an ISOLATED ddev config (its ~/.ddev is not the host's). When Knecht's dev
// server runs on the HOST instead, the flag is unset and we never touch the
// developer's shared ddev — which would break their own projects.
export default defineNitroPlugin(() => {
  if (process.env.KNECHT_MANAGED_DDEV !== '1') return
  void ensureRouterless()
})

async function ensureRouterless(): Promise<void> {
  try {
    await execa('ddev', ['config', 'global', '--omit-containers=ddev-router'])
  }
  catch (e) {
    console.error('[knecht] could not omit ddev-router:', (e as Error).message)
  }
}
