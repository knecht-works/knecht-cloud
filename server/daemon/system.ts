import { execa } from 'execa'
import { availableUpdate, currentVersion } from '#server/utils/version'
import { getSettings } from '#server/utils/settings'

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
    availableUpdate(getSettings().prereleaseUpdates),
  ])

  const version = {
    current: currentVersion(),
    latest,
    updateAvailable: latest !== null,
  }

  return { dockerVersion, ddevVersion, hostContainers, version }
}
