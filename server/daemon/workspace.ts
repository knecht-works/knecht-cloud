import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { parse } from 'yaml'
import { writeBridgeCredentialHelper } from '../utils/agent-bridge'
import { sessionCheckoutDir, sessionSandboxName } from '../utils/storage'
import { getProject } from '../stores/projects'
import { getSessionRow } from '../stores/sessions'
import { KNECHT_COMPOSE_FILE, KNECHT_CONFIG_FILE } from './ddev'
import { attachKnecht, ddevWebImage, forgetPreview, knechtContainer, WEB_PROJECT_DIR } from './sandbox'

export const WORKSPACE_LABEL = 'works.knecht.workspace'

// The workspace has no preview: Knecht's own values would point the agent at one.
const PREVIEW_ENV = /^(KNECHT_PREVIEW_URL|KNECHT_INTERNAL_URL|KNECHT_DEV_SERVER_URL|KNECHT_URL_\w+)=/

export function workspaceContainerName(sessionId: number): string {
  return `${sessionSandboxName(sessionId)}-workspace`
}

const starting = new Map<number, Promise<void>>()

export function ensureWorkspaceUp(sessionId: number): Promise<void> {
  let pending = starting.get(sessionId)
  if (!pending) {
    pending = startWorkspace(sessionId).finally(() => starting.delete(sessionId))
    starting.set(sessionId, pending)
  }
  return pending
}

export async function workspaceRunning(sessionId: number): Promise<boolean> {
  try {
    const { stdout } = await execa('docker', ['inspect', '-f', '{{.State.Running}}', workspaceContainerName(sessionId)])
    return stdout.trim() === 'true'
  }
  catch {
    return false
  }
}

async function startWorkspace(sessionId: number): Promise<void> {
  if (await workspaceRunning(sessionId)) return
  const name = workspaceContainerName(sessionId)
  const dir = sessionCheckoutDir(sessionId)
  const session = getSessionRow(sessionId)
  const project = session && getProject(session.projectId)
  const web = readWebOverrides(dir, new Set(project?.envVars.map(e => e.key)))
  await execa('docker', ['rm', '-f', name]).catch(() => {})
  await createNetwork(sessionId, name)
  const envDir = await mkdtemp(join(tmpdir(), 'knecht-workspace-'))
  try {
    // A file, not `-e`: the project's env vars hold secrets.
    const envFile = join(envDir, 'env')
    await writeFile(envFile, web.environment.map(e => `${e}\n`).join(''), { mode: 0o600 })
    await execa('docker', [
      'run', '-d', '--rm',
      '--name', name,
      '--label', `${WORKSPACE_LABEL}=${sessionId}`,
      '--network', name,
      '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      '--workdir', WEB_PROJECT_DIR,
      '--env-file', envFile,
      ...(web.memLimit ? ['--memory', web.memLimit] : []),
      ...(web.pidsLimit ? ['--pids-limit', String(web.pidsLimit)] : []),
      '-v', `${dir}:${WEB_PROJECT_DIR}`,
      // Where the ddev shim looks up the project's own web commands.
      '-v', `${join(dir, '.ddev')}:/mnt/ddev_config:ro`,
      '-v', 'ddev-global-cache:/mnt/ddev-global-cache',
      ...web.volumes.flatMap(v => ['-v', v]),
      '--entrypoint', 'sleep',
      await workspaceImage(),
      'infinity',
    ])
  }
  finally {
    await rm(envDir, { recursive: true, force: true })
  }
  await attachKnecht(name)
  await writeBridgeCredentialHelper(dir, sessionId).catch(() => {})
}

async function createNetwork(sessionId: number, name: string): Promise<void> {
  const { exitCode, stderr } = await execa('docker', ['network', 'create', '--label', `${WORKSPACE_LABEL}=${sessionId}`, name], { reject: false })
  if (exitCode !== 0 && !stderr.includes('already exists')) throw new Error(`docker network create ${name} failed: ${stderr.trim()}`)
}

let image: Promise<string> | undefined

// ddev's per-project build adds the host user; without a passwd entry HOME falls back to /tmp.
function workspaceImage(): Promise<string> {
  image ??= buildWorkspaceImage().catch((e: unknown) => {
    image = undefined
    throw e
  })
  return image
}

async function buildWorkspaceImage(): Promise<string> {
  const base = await ddevWebImage()
  const uid = process.getuid?.() ?? 1000
  const gid = process.getgid?.() ?? 1000
  const tag = `knecht-workspace:${base.split(':').at(-1)}-${uid}-${gid}`
  const exists = await execa('docker', ['image', 'inspect', tag]).then(() => true, () => false)
  if (!exists) {
    await execa('docker', ['build', '-t', tag, '-'], {
      input: `FROM ${base}\nRUN (getent group ${gid} || groupadd -g ${gid} knecht) && (getent passwd ${uid} || useradd -m -u ${uid} -g ${gid} -s /bin/bash knecht)\n`,
    })
  }
  return tag
}

export async function removeWorkspace(sessionId: number): Promise<void> {
  const name = workspaceContainerName(sessionId)
  // The next workspace may get another IP.
  forgetPreview(sessionId)
  const self = await knechtContainer()
  if (self) await execa('docker', ['network', 'disconnect', name, self]).catch(() => {})
  await execa('docker', ['rm', '-f', name]).catch(() => {})
  await execa('docker', ['network', 'rm', name]).catch(() => {})
}

interface WebOverrides {
  environment: string[]
  volumes: string[]
  memLimit?: string
  pidsLimit?: number
}

interface DdevProjectConfig {
  name?: string
  type?: string
  docroot?: string
  composer_root?: string
  php_version?: string | number
  nodejs_version?: string | number
  webserver_type?: string
  web_environment?: string[]
}

// The web service's mounts and env as Knecht last wrote them for this checkout.
// `projectKeys` are the project's own env vars, which win over Knecht's preview values.
export function readWebOverrides(checkoutDir: string, projectKeys: Set<string> = new Set()): WebOverrides {
  const repo = readYaml(join(checkoutDir, '.ddev', 'config.yaml')) as DdevProjectConfig | null
  const knecht = readYaml(join(checkoutDir, '.ddev', KNECHT_CONFIG_FILE)) as DdevProjectConfig | null
  const compose = readYaml(join(checkoutDir, '.ddev', KNECHT_COMPOSE_FILE)) as {
    services?: { web?: { volumes?: string[], mem_limit?: string, pids_limit?: number } }
  } | null
  if (!knecht || !compose) throw new Error(`The checkout has no Knecht environment config in ${join(checkoutDir, '.ddev')}`)
  const web = compose.services?.web
  const environment = [...repo?.web_environment ?? [], ...knecht.web_environment ?? []]
    .filter(e => !PREVIEW_ENV.test(e) || projectKeys.has(e.slice(0, e.indexOf('='))))
  return {
    // Compose escapes `$` as `$$`; an env file takes values literally.
    environment: [...ddevProjectEnv({ ...repo, ...knecht }), ...environment].map(e => e.replaceAll('$$', '$')),
    volumes: web?.volumes ?? [],
    memLimit: web?.mem_limit,
    pidsLimit: web?.pids_limit,
  }
}

// What ddev sets in every web container; the shim and CMS settings files read it.
function ddevProjectEnv(cfg: DdevProjectConfig): string[] {
  const entries: Record<string, string | number | undefined> = {
    IS_DDEV_PROJECT: 'true',
    DDEV_PROJECT: cfg.name,
    DDEV_SITENAME: cfg.name,
    DDEV_PROJECT_TYPE: cfg.type,
    DDEV_DOCROOT: cfg.docroot,
    DDEV_COMPOSER_ROOT: cfg.composer_root ? join(WEB_PROJECT_DIR, cfg.composer_root) : WEB_PROJECT_DIR,
    DDEV_PHP_VERSION: cfg.php_version,
    DDEV_WEBSERVER_TYPE: cfg.webserver_type,
  }
  return Object.entries(entries).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`)
}

function readYaml(path: string): unknown {
  return existsSync(path) ? parse(readFileSync(path, 'utf8')) : null
}
