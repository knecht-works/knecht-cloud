import { syncCaddyfile } from '#server/daemon/caddy'
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin(() => {
  void syncCaddyfile()
    .then((restarted) => {
      if (restarted) console.log('[caddy] restarted to load the updated Caddyfile')
    })
    .catch(err => console.error('[caddy] Caddyfile check failed:', err))
})
