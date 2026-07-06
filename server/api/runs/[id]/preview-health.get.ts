import { request as httpRequest } from 'node:http'
import { resolvePreview } from '../../../daemon/sandbox'
import { readDdevHosts } from '../../../daemon/ddev'
import { runWorktreeDir } from '../../../utils/storage'

// GET /api/runs/:id/preview-health → whether the booted env is actually serving
// a usable page yet. envState flips to 'up' the moment `ddev start` returns, but
// the boot workflow keeps going (composer install, asset build), so the preview
// iframe would otherwise load a half-built site. The dashboard polls this and
// holds the frame back until the app answers on :80 with a non-5xx status —
// which covers the "still starting / installing" window (a missing vendor/ or a
// booting router 5xx / refuses). A 200-but-unstyled page mid asset-build looks
// the same to an HTTP probe as a finished one, so that case isn't caught here.
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  if (run.envState !== 'up') return { ready: false }

  const addr = await resolvePreview(id)
  if (!addr) return { ready: false }

  const host = readDdevHosts(runWorktreeDir(id)).primary
  if (!host) return { ready: false }

  return { ready: await probe(addr, host) }
})

// One GET to the sandbox's inner router (same target the proxy hits), sending
// the app's real Host so ddev routes it. Ready = a response with status < 500;
// a refused connection, a timeout or a 5xx all read as "not ready yet".
function probe(addr: string, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest(
      { host: addr, port: 80, method: 'GET', path: '/', headers: { host }, timeout: 3000 },
      (res) => {
        res.resume() // drain so the socket frees
        resolve((res.statusCode ?? 500) < 500)
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
    req.end()
  })
}
