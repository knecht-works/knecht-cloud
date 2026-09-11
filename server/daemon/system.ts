import { execa } from 'execa'
import { currentVersion, isNewerVersion, latestVersion } from '../utils/version'

export interface SystemInfo {
  dockerVersion: string
  ddevVersion: string | null
  hostContainers: string[]
  version: { current: string, latest: string | null, updateAvailable: boolean }
}

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
