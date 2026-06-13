import { execa } from 'execa'

export interface SystemInfo {
  /** The ddev version string, or 'not available' if ddev couldn't be reached. */
  ddevVersion: string
  /** Names of all containers on the host daemon (proves DooD from inside). */
  hostContainers: string[]
}

/**
 * The first "daemon slice": shell out to ddev and the host Docker daemon and
 * report what we find. This is the same thing we validated by hand in the DooD
 * harness, now done programmatically — UI → API → here → execa → ddev/docker.
 *
 * Lives in server/daemon/ (not in the route) so the HTTP layer stays thin and
 * the orchestration logic is portable — see internals/docs/tech-stack.md §6.
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  const [ddevVersion, hostContainers] = await Promise.all([
    execa('ddev', ['--version'])
      .then(r => r.stdout.trim().split(/\s+/).pop() ?? 'unknown')
      .catch(() => 'not available'),
    execa('docker', ['ps', '--format', '{{.Names}}'])
      .then(r => String(r.stdout).split('\n').map(s => s.trim()).filter(Boolean))
      .catch(() => []),
  ])

  return { ddevVersion, hostContainers }
}
