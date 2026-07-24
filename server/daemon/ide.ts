import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { execa } from 'execa'
import { resolveContainerUser, resolvePreview, webContainerName, WEB_PROJECT_DIR } from './sandbox'
import { toolsDir } from '../utils/storage'

// The web IDE: openvscode-server (the MIT-licensed VS Code web build) running
// INSIDE a run's web container against the mounted checkout. The server
// tarball is staged once per host into the tools dir (like opencode) and
// bind-mounted read-only into every run's web container (daemon/ddev.ts);
// starting the IDE is one detached exec. Reachable only through the ide
// preview origin (utils/ide-proxy.ts): the port never leaves the container
// network, the proxy owns auth, so no connection token is needed.

const OPENVSCODE_VERSION = '1.109.5'

// Inside the web container (read-only mount, daemon/ddev.ts).
export const IDE_CONTAINER_DIR = '/usr/local/lib/openvscode-server'
export const IDE_PORT = 3939

export function ideHostDir(): string {
  return join(toolsDir(), 'openvscode-server')
}

export function ideStaged(): boolean {
  return existsSync(join(ideHostDir(), 'bin', 'openvscode-server'))
}

// Download + unpack the release tarball for this host's arch. Called from the
// boot staging (plugins/agent-tools.ts, best-effort) and lazily when the
// first IDE click finds it missing. ~120MB download, so concurrent callers
// share one promise.
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

// The defaults every IDE starts with, injected by the IDE proxy into the
// workbench HTML's embedded configuration (ide-proxy.ts). That is the ONLY
// channel that reaches VS Code WEB: user settings live in the browser
// (IndexedDB, not the server's User dir), and the web workbench only registers
// default overrides from the top-level `configurationDefaults` construction
// option, not from product.json or productConfiguration. These arrive as
// DEFAULT values: whatever the user changes inside the IDE still overrides
// them.
export const IDE_DEFAULT_SETTINGS = {
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.startupEditor': 'none',
  'telemetry.telemetryLevel': 'off',
  // Hides the Copilot chat panel that otherwise opens on first load; there is
  // no way to sign in from this IDE, so it is dead weight.
  'chat.disableAIFeatures': true,
  // Without the chat panel the secondary side bar would open empty.
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
}

// Probe whether the run's IDE server answers. The IDE lives and dies with the
// web container, so there is no bookkeeping to get stale.
export async function ideRunning(runId: number): Promise<boolean> {
  const ip = await resolvePreview(runId)
  if (!ip) return false
  try {
    // Any HTTP answer means the server listens (no assumptions about
    // openvscode's route table).
    await fetch(`http://${ip}:${IDE_PORT}/`, { signal: AbortSignal.timeout(1000) })
    return true
  }
  catch {
    return false
  }
}

// Whether the run's web container lacks the IDE mount: it booted before the
// IDE existed, or before its download finished. The ide endpoint heals this
// with a config-refreshing reboot (daemon/envs.ts rebootEnv).
export async function ideMountMissing(runId: number): Promise<boolean> {
  try {
    await execa('docker', ['exec', webContainerName(runId), 'test', '-x', `${IDE_CONTAINER_DIR}/bin/openvscode-server`])
    return false
  }
  catch {
    return true
  }
}

// Start the IDE in the run's web container (idempotent) and wait until it
// answers. Runs as the same identity every Knecht exec uses; its state lives
// under the checkout's .knecht dir so settings survive container recreates.
export async function startRunIde(runId: number): Promise<void> {
  if (await ideRunning(runId)) return
  if (!ideStaged()) {
    void stageIde().catch(e => console.error('openvscode-server staging failed:', (e as Error).message))
    throw createError({
      statusCode: 503,
      statusMessage: 'The IDE is still being downloaded onto this server. Try again in a minute.',
    })
  }

  const container = webContainerName(runId)
  // Normally healed by the ide endpoint before it calls this; still missing
  // here means the heal did not stick.
  if (await ideMountMissing(runId)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The environment is missing the IDE mount. Reboot it and try again.',
    })
  }

  const user = await resolveContainerUser(runId)
  await execa('docker', [
    'exec', '-d',
    '-u', `${user.uid}:${user.gid}`,
    '-w', WEB_PROJECT_DIR,
    '-e', `HOME=${user.home}`,
    '-e', `USER=${user.user}`,
    container,
    `${IDE_CONTAINER_DIR}/bin/openvscode-server`,
    '--host', '0.0.0.0',
    '--port', String(IDE_PORT),
    '--without-connection-token',
    '--server-data-dir', `${WEB_PROJECT_DIR}/.knecht/vscode`,
    '--default-folder', WEB_PROJECT_DIR,
  ])

  // The server needs a moment to listen; surface a clean error instead of
  // letting the freshly opened tab 503.
  for (let i = 0; i < 30; i++) {
    if (await ideRunning(runId)) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw createError({ statusCode: 502, statusMessage: 'The IDE did not come up. Check the server logs.' })
}
