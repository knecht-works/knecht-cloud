import { setTimeout as sleep } from 'node:timers/promises'
import { DEV_DAEMON_GROUP, PREVIEW_FORWARD_PORT } from './ddev'
import { resolvePreview } from './sandbox'

// The dev server of a generated environment runs under ddev's supervisord
// (daemon/ddev.ts). ddev starts that daemon group right after `ddev start`,
// BEFORE the boot commands install its dependencies (`npm ci`), so the
// first attempts die and supervisord gives up after its
// retries. Every boot path therefore restarts the group once the boot
// commands are through, and then waits until the server answers on its
// port, so previewReady means "something is listening", not "the daemon was
// asked to start".

// How long a dev server gets to answer after its restart: a cold Nuxt/Vite
// start on a small host takes tens of seconds, minutes with a first build.
const DEV_SERVER_TIMEOUT_MS = 120_000
const POLL_MS = 2_000

// `exec` runs one command inside the session's web container and resolves
// its exit code (the boot step's streaming runner, the restore's plain
// exec). supervisord runs as the web user in ddev's image, so its control
// socket is the user's own: no sudo needed.
export async function restartDevServer(exec: (command: string[]) => Promise<number>): Promise<void> {
  const code = await exec(['supervisorctl', 'restart', `${DEV_DAEMON_GROUP}:*`])
  if (code !== 0) throw new Error(`Could not restart the dev server (supervisorctl exited with code ${code})`)
}

// Poll the container through the forwarder until anything answers (a status
// code of any kind: the app is up, what it says is its business). Going
// through the forwarder checks the same path the preview proxy takes.
export async function waitForDevServer(sessionId: number, port: number): Promise<void> {
  const deadline = Date.now() + DEV_SERVER_TIMEOUT_MS
  while (Date.now() < deadline) {
    const ip = await resolvePreview(sessionId)
    if (ip) {
      try {
        await fetch(`http://${ip}:${PREVIEW_FORWARD_PORT}/`, { signal: AbortSignal.timeout(POLL_MS), redirect: 'manual' })
        return
      }
      catch {
        // Not listening yet.
      }
    }
    await sleep(POLL_MS)
  }
  throw new Error(`The dev server did not answer on port ${port} within ${DEV_SERVER_TIMEOUT_MS / 1000}s; check the boot log for its output.`)
}
