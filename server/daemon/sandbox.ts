import { hostname } from 'node:os'
import { execa, type Options } from 'execa'
import { toSandboxProcess, type SandboxProcess } from './sandbox-process'
import { sessionSandboxName, sessionCheckoutDir } from '../utils/storage'

export const WEB_PROJECT_DIR = '/var/www/html'

const KNECHT_STATE_DIR = `${WEB_PROJECT_DIR}/.knecht`

const INGRESS_NETWORK = 'knecht-ingress'

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

// The compose override references the ingress network as external, so it must exist before `ddev start`.
export async function startEnvStack(sessionId: number): Promise<void> {
  await ensureIngressNetwork()
  ipCache.delete(sessionId)
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
  ipCache.delete(sessionId)
  try {
    await execa('ddev', ['stop', sessionSandboxName(sessionId)], { env: DDEV_ENV })
  }
  catch {
    await removeLabelledContainers(sessionId)
  }
}

export async function removeEnvStack(sessionId: number): Promise<void> {
  ipCache.delete(sessionId)
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
  try {
    await execa('docker', ['rm', '-f', sessionSandboxName(sessionId)])
  }
  catch {
    // Only hosts upgraded from Sysbox still have a container under this name.
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

// By IP, not container name: works whether Knecht runs as a container or a host process.
const ipCache = new Map<number, string>()

export async function resolvePreview(sessionId: number): Promise<string | null> {
  const cached = ipCache.get(sessionId)
  if (cached) return cached
  try {
    const { stdout } = await execa('docker', [
      'inspect', '-f',
      `{{with index .NetworkSettings.Networks "${INGRESS_NETWORK}"}}{{.IPAddress}}{{end}}`,
      webContainerName(sessionId),
    ])
    const ip = stdout.trim()
    if (!ip) return null
    ipCache.set(sessionId, ip)
    return ip
  }
  catch {
    return null
  }
}

export function forgetPreview(sessionId: number): void {
  ipCache.delete(sessionId)
}

// Detaching from `ddev_default` is what keeps parallel runs from reaching each other.
async function wireNetworks(sessionId: number): Promise<void> {
  const name = sessionSandboxName(sessionId)
  for (const container of [webContainerName(sessionId), `ddev-${name}-db`]) {
    await execa('docker', ['network', 'disconnect', 'ddev_default', container]).catch(() => {})
  }
}

async function ensureIngressNetwork(): Promise<void> {
  try {
    await execa('docker', ['network', 'create', INGRESS_NETWORK])
  }
  catch {
    // Already exists.
  }
  try {
    await execa('docker', ['network', 'connect', INGRESS_NETWORK, hostname()])
  }
  catch {
    // Already connected, or not a container.
  }
}
