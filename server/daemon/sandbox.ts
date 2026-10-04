import { hostname } from 'node:os'
import { execa, type Options } from 'execa'
import { toSandboxProcess, type SandboxProcess } from './sandbox-process'
import { BRIDGE_HOST, writeBridgeCredentialHelper } from '../utils/agent-bridge'
import { sessionSandboxName, sessionCheckoutDir } from '../utils/storage'

export const WEB_PROJECT_DIR = '/var/www/html'

const KNECHT_STATE_DIR = `${WEB_PROJECT_DIR}/.knecht`

const INGRESS_NETWORK = 'knecht-ingress'

function sessionNetwork(sessionId: number): string {
  return `ddev-${sessionSandboxName(sessionId)}_default`
}

let ownContainer: Promise<string | null> | undefined
// Null for a host process (the dev VM), which reaches the web containers directly.
function knechtContainer(): Promise<string | null> {
  ownContainer ??= execa('docker', ['inspect', hostname()]).then(() => hostname(), () => null)
  return ownContainer
}

export function webContainerName(sessionId: number): string {
  return `ddev-${sessionSandboxName(sessionId)}-web`
}

export function serviceContainerName(sessionId: number, service: string): string {
  return `ddev-${sessionSandboxName(sessionId)}-${service}`
}

export async function listRunServices(sessionId: number): Promise<string[]> {
  try {
    const { stdout } = await execa('docker', [
      'ps', '--filter', `label=com.ddev.site-name=${sessionSandboxName(sessionId)}`,
      '--format', '{{.Label "com.docker.compose.service"}}',
    ])
    const services = [...new Set(stdout.split('\n').map(s => s.trim()).filter(Boolean))]
    return services.sort((a, b) => (a === 'web' ? -1 : b === 'web' ? 1 : a.localeCompare(b)))
  }
  catch {
    return []
  }
}

// Must match EXEC_WRAPPER.
export async function resolveContainerUser(sessionId: number): Promise<{ uid: number, gid: number, user: string, home: string }> {
  const uid = process.getuid?.() ?? 1000
  const gid = process.getgid?.() ?? 1000
  try {
    const { stdout } = await execa('docker', ['exec', webContainerName(sessionId), 'getent', 'passwd', String(uid)])
    const fields = stdout.trim().split(':')
    return { uid, gid, user: fields[0] || 'web', home: fields[5] || '/tmp' }
  }
  catch {
    return { uid, gid, user: 'web', home: '/tmp' }
  }
}

export async function startEnvStack(sessionId: number): Promise<void> {
  forgetPreview(sessionId)
  await execDdev(sessionId, ['start', '-y'])
  await wireNetworks(sessionId)
}

export async function webMountPresent(sessionId: number, dest: string): Promise<boolean> {
  try {
    const { stdout } = await execa('docker', [
      'inspect', '-f', '{{range .Mounts}}{{.Destination}}{{"\\n"}}{{end}}', webContainerName(sessionId),
    ])
    return stdout.split('\n').includes(dest)
  }
  catch {
    return false
  }
}

export async function envStackRunning(sessionId: number): Promise<boolean> {
  try {
    const { stdout } = await execa('docker', ['inspect', '-f', '{{.State.Running}}', webContainerName(sessionId)])
    return stdout.trim() === 'true'
  }
  catch {
    return false
  }
}

// ddev's registry can lag reality; removing the labelled containers equals `ddev stop`.
export async function stopEnvStack(sessionId: number): Promise<void> {
  forgetPreview(sessionId)
  await detachKnecht(sessionId)
  try {
    await execa('ddev', ['stop', sessionSandboxName(sessionId)], { env: DDEV_ENV })
  }
  catch {
    await removeLabelledContainers(sessionId)
  }
}

export async function removeEnvStack(sessionId: number): Promise<void> {
  forgetPreview(sessionId)
  await detachKnecht(sessionId)
  try {
    await execa('ddev', ['delete', '--omit-snapshot', '-y', sessionSandboxName(sessionId)], { env: DDEV_ENV })
  }
  catch {
    // Not a registered project.
  }
  await removeLabelledContainers(sessionId)
  try {
    const { stdout } = await execa('docker', ['volume', 'ls', '-q', '--filter', `label=com.ddev.site-name=${sessionSandboxName(sessionId)}`])
    const volumes = stdout.split('\n').map(v => v.trim()).filter(Boolean)
    if (volumes.length) await execa('docker', ['volume', 'rm', '-f', ...volumes])
  }
  catch {
    // Nothing left.
  }
}

async function removeLabelledContainers(sessionId: number): Promise<void> {
  try {
    const { stdout } = await execa('docker', ['ps', '-aq', '--filter', `label=com.ddev.site-name=${sessionSandboxName(sessionId)}`])
    const ids = stdout.split('\n').map(v => v.trim()).filter(Boolean)
    if (ids.length) await execa('docker', ['rm', '-f', ...ids])
  }
  catch {
    // Nothing left.
  }
}

// GitHub runners export XDG_CONFIG_HOME and ddev honors it for its global
// config dir; unsetting it pins every ddev call to ~/.ddev.
const DDEV_ENV = { DDEV_NONINTERACTIVE: 'true', NO_COLOR: '1', XDG_CONFIG_HOME: undefined }

function execDdev(sessionId: number, args: string[], options?: Options) {
  return execa('ddev', args, {
    cwd: sessionCheckoutDir(sessionId),
    ...options,
    env: { ...DDEV_ENV, ...(options?.env as Record<string, string> | undefined) },
  })
}

// `docker exec -u <uid>` does no passwd lookup, so HOME/USER are derived here.
const EXEC_WRAPPER = 'HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"; [ -n "$HOME" ] || HOME=/tmp; '
  + 'USER="$(id -un 2>/dev/null || echo web)"; export HOME USER; exec "$@"'

// `env` becomes `docker exec -e` so a secret never appears in the command line.
export function execInSandbox(sessionId: number, command: string[], options?: Options, env?: Record<string, string>) {
  if (command[0] === 'ddev') {
    const child = execDdev(sessionId, command.slice(1), { ...options, env: { ...(options?.env as Record<string, string> | undefined), ...env } })
    // Every `ddev start` re-attaches ddev_default, so the detach must follow each one.
    if (command[1] === 'start') void child.then(() => wireNetworks(sessionId), () => {})
    return child
  }
  return execa('docker', dockerExecArgs(sessionId, command, env), options)
}

function dockerExecArgs(sessionId: number, command: string[], env?: Record<string, string>, flags: string[] = []): string[] {
  return [
    'exec', ...flags, '-u', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    '-w', WEB_PROJECT_DIR,
    '-e', `XDG_CONFIG_HOME=${KNECHT_STATE_DIR}`,
    '-e', `XDG_DATA_HOME=${KNECHT_STATE_DIR}/data`,
    '-e', 'NO_COLOR=1',
    ...Object.entries(env ?? {}).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    webContainerName(sessionId),
    '/bin/sh', '-c', EXEC_WRAPPER, 'knecht-exec', ...command,
  ]
}

// `-i` keeps stdin open: the process is a peer that speaks a protocol over stdio.
export function spawnInSandbox(sessionId: number, command: string[], env?: Record<string, string>): SandboxProcess {
  return toSandboxProcess(execa('docker', dockerExecArgs(sessionId, command, env, ['-i']), {
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', buffer: false, reject: false,
  }))
}

export async function copyIntoSandbox(sessionId: number, file: string, dest: string): Promise<void> {
  await execa('docker', ['cp', file, `${webContainerName(sessionId)}:${dest}`])
}

const STREAM_TAIL_CHARS = 128 * 1024

export function streamInSandbox(sessionId: number, command: string[], log: (text: string) => void, env?: Record<string, string>, signal?: AbortSignal): Promise<{ code: number, tail: string }> {
  const sub = execInSandbox(sessionId, command, { reject: false, buffer: false, cancelSignal: signal }, env)
  const chunks: string[] = []
  let size = 0
  const capture = (d: Buffer) => {
    const text = d.toString()
    log(text)
    chunks.push(text)
    size += text.length
    while (size > STREAM_TAIL_CHARS && chunks.length > 1) {
      size -= chunks.shift()!.length
    }
  }
  sub.stdout?.on('data', capture)
  sub.stderr?.on('data', capture)
  return sub.then(r => ({ code: r.exitCode ?? 1, tail: chunks.join('').slice(-STREAM_TAIL_CHARS) }))
}

// By IP, not container name: a host process has no container DNS.
const envCache = new Map<number, { ips: Map<string, string>, exposed?: Promise<ExposedPort[]> }>()

function sessionCache(sessionId: number) {
  let entry = envCache.get(sessionId)
  if (!entry) envCache.set(sessionId, entry = { ips: new Map() })
  return entry
}

export async function resolveContainerIp(sessionId: number, container: string): Promise<string | null> {
  const { ips } = sessionCache(sessionId)
  const cached = ips.get(container)
  if (cached) return cached
  try {
    const { stdout } = await execa('docker', [
      'inspect', '-f',
      `{{with index .NetworkSettings.Networks "${sessionNetwork(sessionId)}"}}{{.IPAddress}}{{end}}`,
      container,
    ])
    const ip = stdout.trim()
    if (!ip) return null
    ips.set(container, ip)
    return ip
  }
  catch {
    return null
  }
}

export function resolvePreview(sessionId: number): Promise<string | null> {
  return resolveContainerIp(sessionId, webContainerName(sessionId))
}

export function forgetPreview(sessionId: number): void {
  envCache.delete(sessionId)
}

export interface ExposedPort { service: string, container: string, port: number }

// The ports a container publishes through ddev's router, which Knecht replaces.
export function exposedPorts(sessionId: number): Promise<ExposedPort[]> {
  const entry = sessionCache(sessionId)
  // Nothing found means the stack is not up yet: ask again next time.
  entry.exposed ??= discoverExposedPorts(sessionId).catch(() => []).then((found) => {
    if (!found.length) entry.exposed = undefined
    return found
  })
  return entry.exposed
}

async function discoverExposedPorts(sessionId: number): Promise<ExposedPort[]> {
  const { stdout } = await execa('docker', [
    'ps', '--filter', `label=com.ddev.site-name=${sessionSandboxName(sessionId)}`,
    '--format', '{{.Names}} {{.Label "com.docker.compose.service"}}',
  ])
  const found: ExposedPort[] = []
  for (const line of stdout.split('\n').filter(Boolean)) {
    const [container = '', service = ''] = line.trim().split(' ')
    const { stdout: env } = await execa('docker', ['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', container])
    found.push(...parseExposeEnv(env).map(port => ({ service, container, port })))
  }
  return found
}

export function parseExposeEnv(env: string): number[] {
  const ports = new Set<number>()
  for (const line of env.split('\n')) {
    const match = /^HTTPS?_EXPOSE=(.*)$/.exec(line.trim())
    for (const pair of match?.[1]?.split(',') ?? []) {
      const port = Number(pair.split(':')[1])
      if (Number.isInteger(port) && port > 0) ports.add(port)
    }
  }
  return [...ports]
}

// Any network shared between runs lets them reach each other; old overrides still join knecht-ingress.
async function wireNetworks(sessionId: number): Promise<void> {
  const name = sessionSandboxName(sessionId)
  for (const container of [webContainerName(sessionId), `ddev-${name}-db`]) {
    for (const network of ['ddev_default', INGRESS_NETWORK]) {
      await execa('docker', ['network', 'disconnect', network, container]).catch(() => {})
    }
  }
  await attachBridgeHost(sessionId)
  await writeBridgeCredentialHelper(sessionCheckoutDir(sessionId), sessionId).catch(() => {})
}

async function attachBridgeHost(sessionId: number): Promise<void> {
  const network = sessionNetwork(sessionId)
  const self = await knechtContainer()
  if (self) {
    await execa('docker', ['network', 'connect', '--alias', BRIDGE_HOST, network, self]).catch(() => {})
    return
  }
  const gateway = await execa('docker', ['network', 'inspect', network, '-f', '{{(index .IPAM.Config 0).Gateway}}']).then(r => r.stdout.trim(), () => '')
  if (!gateway) return
  const entry = `${gateway} ${BRIDGE_HOST}`
  await execa('docker', ['exec', '-u', 'root', webContainerName(sessionId), 'sh', '-c', `grep -qx '${entry}' /etc/hosts || echo '${entry}' >> /etc/hosts`]).catch(() => {})
}

// An attached Knecht keeps ddev from removing the session network on stop.
async function detachKnecht(sessionId: number): Promise<void> {
  const self = await knechtContainer()
  if (self) await execa('docker', ['network', 'disconnect', sessionNetwork(sessionId), self]).catch(() => {})
}
