import { execa } from 'execa'
import { currentVersion, isNewerVersion, latestVersion } from '../utils/version'

export interface SystemInfo {
  /** The host Docker server version, or 'not available' if unreachable. */
  dockerVersion: string
  /** The ddev CLI version, or null when the CLI is missing (runs can't boot). */
  ddevVersion: string | null
  /** Names of all containers on the host daemon (run envs show up here). */
  hostContainers: string[]
  /** Knecht's own release version and whether a newer release exists. */
  version: { current: string, latest: string | null, updateAvailable: boolean }
}

/**
 * The system probe: ask the substrate what Knecht's world looks like: host
 * Docker daemon reachable, the ddev CLI present (it boots the per-run envs),
 * and what's running. UI → API → here → execa.
 *
 * Lives in server/daemon/ (not in the route) so the HTTP layer stays thin and
 * the orchestration logic is portable: see internals/docs/tech-stack.md §6.
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  const [dockerVersion, ddevVersion, hostContainers, latest] = await Promise.all([
    execa('docker', ['version', '--format', '{{.Server.Version}}'])
      .then(r => r.stdout.trim() || 'unknown')
      .catch(() => 'not available'),
    execa('ddev', ['--version'])
      .then(r => r.stdout.replace(/^ddev version\s*/i, '').trim() || 'unknown')
      .catch(() => null),
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

  return { dockerVersion, ddevVersion, hostContainers, version }
}
