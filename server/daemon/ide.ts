import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { execa } from 'execa'
import { resolveContainerUser, resolvePreview, webContainerName, WEB_PROJECT_DIR } from './sandbox'
import { toolsDir } from '../utils/storage'

const OPENVSCODE_VERSION = '1.109.5'
export const IDE_CONTAINER_DIR = '/usr/local/lib/openvscode-server'
export const IDE_PORT = 3939

const IDE_START_TIMEOUT_MS = 15_000
const POLL_MS = 500

export const IDE_DEFAULT_SETTINGS = {
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.startupEditor': 'none',
  'telemetry.telemetryLevel': 'off',
  'chat.disableAIFeatures': true,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
}

export function ideHostDir(): string {
  return join(toolsDir(), 'openvscode-server')
}

export function ideStaged(): boolean {
  return existsSync(join(ideHostDir(), 'bin', 'openvscode-server'))
}

let staging: Promise<void> | null = null
export function stageIde(): Promise<void> {
  if (ideStaged()) return Promise.resolve()
  staging ??= doStageIde().finally(() => {
    staging = null
  })
  return staging
}

async function doStageIde(): Promise<void> {
  const arch = process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  const name = `openvscode-server-v${OPENVSCODE_VERSION}-${arch}`
  const url = `https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${OPENVSCODE_VERSION}/${name}.tar.gz`
  const dir = ideHostDir()
  await mkdir(dir, { recursive: true })
  await execa('bash', ['-c', `curl -fsSL ${url} | tar -xz --strip-components=1 -C ${dir}`])
  console.log('openvscode-server staged into', dir)
}

export async function ideRunning(sessionId: number): Promise<boolean> {
  const ip = await resolvePreview(sessionId)
  if (!ip) return false
  try {
    await fetch(`http://${ip}:${IDE_PORT}/`, { signal: AbortSignal.timeout(1000) })
    return true
  }
  catch {
    return false
  }
}

export async function ideMountMissing(sessionId: number): Promise<boolean> {
  try {
    await execa('docker', ['exec', webContainerName(sessionId), 'test', '-x', `${IDE_CONTAINER_DIR}/bin/openvscode-server`])
    return false
  }
  catch {
    return true
  }
}

export async function startRunIde(sessionId: number): Promise<void> {
  if (await ideRunning(sessionId)) return
  if (!ideStaged()) {
    void stageIde().catch(e => console.error('openvscode-server staging failed:', (e as Error).message))
    throw createError({
      statusCode: 503,
      statusMessage: 'The IDE is still being downloaded onto this server. Try again in a minute.',
    })
  }
  if (await ideMountMissing(sessionId)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The environment is missing the IDE mount. Reboot it and try again.',
    })
  }

  const user = await resolveContainerUser(sessionId)
  await execa('docker', [
    'exec', '-d',
    '-u', `${user.uid}:${user.gid}`,
    '-w', WEB_PROJECT_DIR,
    '-e', `HOME=${user.home}`,
    '-e', `USER=${user.user}`,
    webContainerName(sessionId),
    `${IDE_CONTAINER_DIR}/bin/openvscode-server`,
    '--host', '0.0.0.0',
    '--port', String(IDE_PORT),
    '--without-connection-token',
    '--server-data-dir', `${WEB_PROJECT_DIR}/.knecht/vscode`,
    '--default-folder', WEB_PROJECT_DIR,
  ])
  await waitForIde(sessionId)
}

async function waitForIde(sessionId: number): Promise<void> {
  const deadline = Date.now() + IDE_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await ideRunning(sessionId)) return
    await sleep(POLL_MS)
  }
  throw createError({ statusCode: 502, statusMessage: 'The IDE did not come up. Check the server logs.' })
}
