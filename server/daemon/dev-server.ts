import { setTimeout as sleep } from 'node:timers/promises'
import { PREVIEW_FORWARD_PORT } from '#shared/utils/preview-host'
import { DEV_DAEMON_GROUP, previewTargetPort } from '#server/daemon/ddev'
import { resolvePreview } from '#server/daemon/sandbox'
import { devServerOrigin, devServerUseNote } from '#server/utils/dev-origin'
import { fetchFrom } from '#server/utils/favicon'
import { getSessionRow } from '#server/stores/sessions'

// ddev starts the daemon group before the boot commands install its
// dependencies, so supervisord gives up on it and every boot path restarts it.

const DEV_SERVER_TIMEOUT_MS = 120_000
const POLL_MS = 2_000

export async function restartDevServer(exec: (command: string[]) => Promise<number>): Promise<void> {
  const code = await exec(['supervisorctl', 'restart', `${DEV_DAEMON_GROUP}:*`])
  if (code !== 0) throw new Error(`Could not restart the dev server (supervisorctl exited with code ${code})`)
}

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

const START_PAGE_MAX_BYTES = 2_000_000

// Only for a repo's own ddev config: in a generated environment the dev server serves the page itself.
export async function noteDevServerUse(sessionId: number, log: (text: string) => void): Promise<void> {
  try {
    const session = getSessionRow(sessionId)
    const primary = session?.previewHosts[0]
    if (!session || session.previewPort == null || !primary) return
    const addr = await resolvePreview(sessionId)
    if (!addr) return
    const page = await fetchFrom(addr, previewTargetPort(session), primary, '/', START_PAGE_MAX_BYTES)
    if (!page || !/text\/html/i.test(page.contentType ?? '')) return
    const devOrigin = devServerOrigin(sessionId)
    const dev = { port: session.previewPort, hosts: session.previewHosts }
    const note = devServerUseNote(page.body.toString('utf8'), dev, devOrigin && new URL(devOrigin).host)
    if (note) log(`\n${note}\n`)
  }
  catch {
    // Best-effort.
  }
}
