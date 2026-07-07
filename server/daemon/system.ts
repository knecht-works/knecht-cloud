import { execa } from 'execa'
import { currentVersion, isNewerVersion, latestVersion } from '../utils/version'

export interface SystemInfo {
  /** The host Docker server version, or 'not available' if unreachable. */
  dockerVersion: string
  /** Whether the sysbox-runc runtime is registered on the host daemon. */
  sysboxAvailable: boolean
  /** Names of all containers on the host daemon (sandboxes show up here). */
  hostContainers: string[]
  /** Knecht's own release version and whether a newer release exists. */
  version: { current: string, latest: string | null, updateAvailable: boolean }
}

/**
 * The system probe: ask the host Docker daemon what Knecht's substrate looks
 * like: daemon reachable, Sysbox runtime registered (the per-run sandboxes
 * need it, run-isolation.md §7), and what's running. UI → API → here → execa.
 *
 * Lives in server/daemon/ (not in the route) so the HTTP layer stays thin and
 * the orchestration logic is portable: see internals/docs/tech-stack.md §6.
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  const [dockerVersion, sysboxAvailable, hostContainers, latest] = await Promise.all([
    execa('docker', ['version', '--format', '{{.Server.Version}}'])
      .then(r => r.stdout.trim() || 'unknown')
      .catch(() => 'not available'),
    execa('docker', ['info', '--format', '{{json .Runtimes}}'])
      .then(r => r.stdout.includes('sysbox-runc'))
      .catch(() => false),
    execa('docker', ['ps', '--format', '{{.Names}}'])
      .then(r => String(r.stdout).split('\n').map(s => s.trim()).filter(Boolean))
      .catch(() => []),
    latestVersion(),
  ])

  const current = currentVersion()
  const version = {
    current,
    latest,
    updateAvailable: latest !== null && isNewerVersion(latest, current),
  }

  return { dockerVersion, sysboxAvailable, hostContainers, version }
}
