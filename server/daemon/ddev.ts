import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { EnvVar } from '../../shared/utils/env'
import { resolveEnv, type EnvOverrides, type ResolvedEnv } from '../../shared/utils/env-spec'
import { PREVIEW_FORWARD_PORT, previewHostname, previewLabel } from '../../shared/utils/preview-host'
import { checkoutReader, detectEnv, GENERATED_MARKER, parseDdevConfig, type DdevConfigFile } from '../utils/env-detect'
import { sessionEnv } from '../utils/knecht-env'
import { dashboardOrigin } from '../utils/origin'
import { normalizeSharedFolder, projectSharedDir, sessionSandboxName, toolsDir } from '../utils/storage'
import { WEB_PROJECT_DIR } from './sandbox'

export type UrlMode = 'env' | 'rewrite'

const WEB_MEM_LIMIT = '2g'
const DB_MEM_LIMIT = '1g'
const WEB_PIDS_LIMIT = 2048

export const DEV_DAEMON_GROUP = 'webextradaemons'

export interface PreviewSession {
  previewHosts: string[]
  previewPort: number | null
}

// A repo's own ddev config always carries a hostname, so an empty host list means a generated environment.
export function devServerIsPreview(session: PreviewSession): boolean {
  return session.previewHosts.length === 0 && session.previewPort != null
}

export function previewTargetPort(session: PreviewSession, devLabel = false): number {
  return devLabel || devServerIsPreview(session) ? PREVIEW_FORWARD_PORT : 80
}

// pnpm 9 and 10 only read the npm-style cache name, and that name makes npm
// warn on every call, so it is only set for pnpm repos.
const DDEV_GLOBAL_CACHE = '/mnt/ddev-global-cache'
const PACKAGE_CACHE_ENV = [
  `pnpm_config_store_dir=${DDEV_GLOBAL_CACHE}/pnpm-store`,
  `YARN_CACHE_FOLDER=${DDEV_GLOBAL_CACHE}/yarn`,
  `YARN_GLOBAL_FOLDER=${DDEV_GLOBAL_CACHE}/yarn-berry`,
  `BUN_INSTALL_CACHE_DIR=${DDEV_GLOBAL_CACHE}/bun`,
]
const PNPM_LEGACY_STORE_ENV = `npm_config_store_dir=${DDEV_GLOBAL_CACHE}/pnpm-store`

export interface SessionEnvProject extends EnvOverrides {
  id: number
  envVars: EnvVar[]
  sharedFolders: string[]
}

export interface SessionEnvResult {
  env: ResolvedEnv
  warnings: string[]
  injected: number
  devServerPort: number | null
  changed: boolean
}

// The caller must pin devServerPort on the session right away: the preview proxy reads that pin live.
export async function configureSessionEnv(checkoutDir: string, project: SessionEnvProject, sessionId: number, urlMode: UrlMode): Promise<SessionEnvResult> {
  const detected = detectEnv(checkoutReader(checkoutDir))
  const env = resolveEnv(detected, project)
  const written = await writeDdevConfig(checkoutDir, {
    sessionId,
    env,
    envVars: project.envVars,
    urlMode,
    shared: { projectId: project.id, folders: project.sharedFolders },
  })
  return { env, warnings: detected.warnings, ...written }
}

export interface SharedFolderConfig {
  projectId: number
  folders: string[]
}

export interface DdevConfigInput {
  sessionId: number
  env: ResolvedEnv
  envVars: EnvVar[]
  urlMode: UrlMode
  shared?: SharedFolderConfig
}

// ddev merges override files in name order, last wins: `zzz-` puts Knecht's
// overrides after anything the repo commits itself.
export const KNECHT_CONFIG_FILE = 'config.zzz-knecht.yaml'
export const KNECHT_COMPOSE_FILE = 'docker-compose.zzz-knecht.yaml'
// ddev would merge leftover old override files in (list fields get appended), so every write removes them.
const LEGACY_OVERRIDE_FILES = ['config.knecht.yaml', 'docker-compose.knecht.yaml']

// host_*_port: ddev ignores an empty override and its registry treats any
// literal value as reserved, so a shared placeholder collides across parallel runs.
// XDEBUG_MODE=off: ddev's merge ignores `xdebug_enabled: false`.
export async function writeDdevConfig(checkoutDir: string, { sessionId, env, envVars, urlMode, shared }: DdevConfigInput): Promise<Pick<SessionEnvResult, 'injected' | 'devServerPort' | 'changed'>> {
  const [dbPort, webserverPort, httpsPort, mailpitPort] = await freeHostPorts(4)
  const ddevDir = join(checkoutDir, '.ddev')
  const name = sessionSandboxName(sessionId)
  const devServer = devServerFor(env)
  let changed = false
  if (env.source === 'generated') {
    mkdirSync(ddevDir, { recursive: true })
    changed = syncFile(join(ddevDir, 'config.yaml'), `${GENERATED_MARKER}\n` + stringify({
      name,
      type: 'php',
      docroot: '',
      webserver_type: 'generic',
      php_version: env.phpVersion.value,
      nodejs_version: env.nodeVersion.value,
      omit_containers: ['db'],
      corepack_enable: true,
      disable_settings_management: true,
    })) || changed
    changed = writeBunImageFile(ddevDir, env) || changed
  }
  const doc: {
    name: string
    host_db_port: string
    host_webserver_port: string
    host_https_port: string
    host_mailpit_port: string
    web_environment?: string[]
    web_extra_daemons?: { name: string, command: string, directory: string }[]
  } = { name, host_db_port: String(dbPort), host_webserver_port: String(webserverPort), host_https_port: String(httpsPort), host_mailpit_port: String(mailpitPort) }
  const translate = urlMode === 'env'
    ? envUrlTranslator(env.hosts.value, sessionId)
    : (v: string) => v
  const hasPreview = env.source === 'ddev' || devServer !== null
  const session = hasPreview ? sessionEnv(sessionId, env.hosts.value, devServer !== null) : {}
  Object.assign(session, ddevUrlEnv(env.hosts.value, session.KNECHT_PREVIEW_URL, translate), { XDEBUG_MODE: 'off' })
  const known = new Map(Object.entries(session))
  const environment: string[] = []
  for (const e of envVars) {
    // Quotes break ddev's generated compose YAML; an unescaped `$` is
    // interpolated by compose against the HOST environment.
    const value = translate(expandEnvRefs(unquote(e.value), known))
    known.set(e.key, value)
    environment.push(`${e.key}=${value.replace(/\$/g, () => '$$')}`)
  }
  // A project's own line for a session variable wins on purpose.
  environment.push(...Object.entries(session)
    .filter(([key]) => !envVars.some(e => e.key === key))
    .map(([key, value]) => `${key}=${value}`))
  environment.push(...PACKAGE_CACHE_ENV)
  if (env.packageManager.value.name === 'pnpm') environment.push(PNPM_LEGACY_STORE_ENV)
  if (devServer !== null) {
    // Vite 5.4.12/6.0.9 and up read extra allowed hosts from this variable.
    const devUrl = session.KNECHT_DEV_SERVER_URL
    if (devUrl) environment.push(`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=${new URL(devUrl).hostname}`)
    doc.web_extra_daemons = [
      { name: 'knecht-dev', command: devDaemonCommand(devServer.command), directory: WEB_PROJECT_DIR },
      { name: 'knecht-forward', command: `knecht-forward ${PREVIEW_FORWARD_PORT} ${devServer.port}`, directory: WEB_PROJECT_DIR },
    ]
  }
  if (environment.length) doc.web_environment = environment
  const marker = '#ddev-silent-no-warn\n'
  changed = syncKnechtConfig(join(ddevDir, KNECHT_CONFIG_FILE), marker + stringify(doc)) || changed
  changed = syncFile(join(ddevDir, KNECHT_COMPOSE_FILE), marker + stringify(composeOverride({
    hasDb: env.hasDb.value,
    sharedMounts: shared ? sharedFolderMounts(shared) : [],
  }))) || changed
  for (const legacy of LEGACY_OVERRIDE_FILES) changed = removeFile(join(ddevDir, legacy)) || changed
  if (env.hasDb.value) changed = writeLowmemDbConfig(checkoutDir, marker) || changed
  return { injected: envVars.length, devServerPort: devServer?.port ?? null, changed }
}

// ddev leaves DDEV_PRIMARY_URL, DDEV_HOSTNAME and DDEV_SCHEME empty without the
// router, and its Drupal/TYPO3/WordPress settings files build URLs from them.
function ddevUrlEnv(hosts: string[], preview: string | undefined, translate: (value: string) => string): Record<string, string> {
  const primary = hosts.length ? translate(`https://${hosts[0]}`) : preview
  if (!primary) return {}
  const url = new URL(primary)
  return {
    DDEV_PRIMARY_URL: primary,
    DDEV_PRIMARY_URL_WITHOUT_PORT: `${url.protocol}//${url.hostname}`,
    DDEV_PRIMARY_URL_PORT: url.port || (url.protocol === 'https:' ? '443' : '80'),
    DDEV_SCHEME: url.protocol.slice(0, -1),
    DDEV_HOSTNAME: hosts.length ? hosts.map(translate).join(',') : url.hostname,
  }
}

function syncFile(path: string, text: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false
  writeFileSync(path, text)
  return true
}

function removeFile(path: string): boolean {
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}

// host_*_port lines are probed fresh on every write and must not count towards
// `changed`, or every idle reboot would restart the stack.
const HOST_PORT_LINE = /^(host_(?:db|webserver|https|mailpit)_port: ).*$/gm
function syncKnechtConfig(path: string, text: string): boolean {
  const mask = (s: string) => s.replace(HOST_PORT_LINE, '$1<port>')
  const prior = existsSync(path) ? readFileSync(path, 'utf8') : null
  writeFileSync(path, text)
  return prior === null || mask(prior) !== mask(text)
}

// ddev's ~/.ddev/project_list.yaml reserves stopped projects' ports too. Sockets
// stay open until the batch is complete so a probe cannot reuse a port it just released.
export async function freeHostPorts(count: number, reserved: Set<number> = ddevReservedHostPorts()): Promise<number[]> {
  const held: Server[] = []
  const ports: number[] = []
  try {
    for (let round = 0; ports.length < count; round++) {
      if (round === 10) throw new Error(`Could not find ${count} host ports free of ddev's registry in ${round} rounds`)
      const servers = await Promise.all(Array.from({ length: count - ports.length }, () => new Promise<Server>((resolve, reject) => {
        const server = createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => resolve(server))
      })))
      held.push(...servers)
      for (const server of servers) {
        const port = (server.address() as AddressInfo).port
        if (!reserved.has(port)) ports.push(port)
      }
    }
    return ports
  }
  finally {
    held.forEach(server => server.close())
  }
}

export function ddevReservedHostPorts(path = join(homedir(), '.ddev', 'project_list.yaml')): Set<number> {
  if (!existsSync(path)) return new Set()
  return reservedHostPortsIn(readFileSync(path, 'utf8'))
}

export function reservedHostPortsIn(registry: string): Set<number> {
  const reserved = new Set<number>()
  let projects: unknown
  try {
    projects = parse(registry)
  }
  catch {
    return reserved
  }
  if (!projects || typeof projects !== 'object') return reserved
  for (const project of Object.values(projects as Record<string, unknown>)) {
    const ports = (project as { used_host_ports?: unknown } | null)?.used_host_ports
    if (!Array.isArray(ports)) continue
    for (const port of ports) {
      const n = Number(port)
      if (Number.isInteger(n) && n > 0) reserved.add(n)
    }
  }
  return reserved
}

function devServerFor(env: ResolvedEnv): { command: string, port: number } | null {
  if (!env.devServer.value || env.previewPort.value === null) return null
  return { command: env.devServer.value, port: env.previewPort.value }
}

// ddev wraps the value in `bash -c "..."`: both quoting layers are escaped.
export function devDaemonCommand(devServer: string): string {
  const inner = `bash -lc '${devServer.replace(/'/g, `'\\''`)}'`
  return inner.replace(/[\\"$`]/g, m => `\\${m}`)
}

function writeBunImageFile(ddevDir: string, env: ResolvedEnv): boolean {
  const dockerfile = join(ddevDir, 'web-build', 'Dockerfile.knecht')
  const { name, version } = env.packageManager.value
  if (name !== 'bun') return removeFile(dockerfile)
  mkdirSync(join(ddevDir, 'web-build'), { recursive: true })
  return syncFile(dockerfile, `RUN npm install -g bun@${version ?? 'latest'}\n`)
}

// `00-` loads first, so a repo's own `.ddev/mysql` tuning overrides this.
function writeLowmemDbConfig(checkoutDir: string, marker: string): boolean {
  const dir = join(checkoutDir, '.ddev', 'mysql')
  mkdirSync(dir, { recursive: true })
  return syncFile(join(dir, '00-knecht-lowmem.cnf'), `${marker}[mysqld]
innodb-buffer-pool-size = 256M
performance_schema = OFF
max-connections = 30
tmp-table-size = 16M
max-heap-table-size = 16M
key-buffer-size = 8M
`)
}

// A missing bind source makes docker create it root-owned.
function sharedFolderMounts(shared: SharedFolderConfig): { host: string, dest: string }[] {
  const root = projectSharedDir(shared.projectId)
  const mounts: { host: string, dest: string }[] = []
  for (const folder of shared.folders) {
    const path = normalizeSharedFolder(folder)
    if (!path) continue
    const host = join(root, path)
    mkdirSync(host, { recursive: true })
    mounts.push({ host, dest: `${WEB_PROJECT_DIR}/${path}` })
  }
  return mounts
}

// Tool mounts only work because the tools dir is mounted at the same path inside
// the Knecht container. A db entry without an image is a compose error when ddev omits the db.
function composeOverride({ hasDb, sharedMounts }: { hasDb: boolean, sharedMounts: { host: string, dest: string }[] }): Record<string, unknown> {
  const tools = toolsDir()
  const toolMounts = [
    { host: join(tools, 'opencode'), dest: '/usr/local/bin/opencode' },
    { host: join(tools, 'knecht-git'), dest: '/usr/local/bin/knecht-git' },
    { host: join(tools, 'knecht-reply'), dest: '/usr/local/bin/knecht-reply' },
    { host: join(tools, 'knecht-label'), dest: '/usr/local/bin/knecht-label' },
    { host: join(tools, 'knecht-status'), dest: '/usr/local/bin/knecht-status' },
    { host: join(tools, 'knecht-forward'), dest: '/usr/local/bin/knecht-forward' },
    { host: join(tools, 'knecht-bridge-lib'), dest: '/usr/local/lib/knecht-bridge-lib' },
    // Shadows the stock in-container ddev shim, which silently no-ops.
    { host: join(tools, 'ddev-shim'), dest: '/usr/local/bin/ddev' },
    { host: join(tools, 'openvscode-server'), dest: '/usr/local/lib/openvscode-server' },
  ].filter(m => existsSync(m.host))
  const volumes = [
    ...toolMounts.map(m => `${m.host}:${m.dest}:ro`),
    ...sharedMounts.map(m => `${m.host}:${m.dest}`),
  ]
  return {
    services: {
      web: {
        mem_limit: WEB_MEM_LIMIT,
        pids_limit: WEB_PIDS_LIMIT,
        // Mapping form: compose refuses to merge it with ddev's list form.
        networks: { 'knecht-ingress': {} },
        ...(volumes.length ? { volumes } : {}),
      },
      ...(hasDb ? { db: { mem_limit: DB_MEM_LIMIT } } : {}),
    },
    networks: {
      'knecht-ingress': { external: true },
    },
  }
}

// Longest host first, or a host that is a suffix of another is half-translated.
function envUrlTranslator(hosts: string[], sessionId: number): (value: string) => string {
  const base = dashboardOrigin()
  if (!base || !hosts.length) return v => v
  const origin = new URL(base)
  const primary = hosts[0]
  const mappings = [...hosts]
    .sort((a, b) => b.length - a.length)
    .map((host) => {
      const label = host === primary ? undefined : previewLabel(host)
      return {
        host,
        previewOrigin: `${origin.protocol}//${previewHostname(sessionId, origin.host, label)}`,
        previewBare: previewHostname(sessionId, origin.hostname, label),
      }
    })
  return (value: string) => {
    for (const m of mappings) {
      value = value
        .replaceAll(`https://${m.host}`, m.previewOrigin)
        .replaceAll(`http://${m.host}`, m.previewOrigin)
        .replaceAll(m.host, m.previewBare)
    }
    return value
  }
}

// Unknown names stay as written: a literal `$` in a password must survive.
function expandEnvRefs(value: string, known: Map<string, string>): string {
  return value.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (match, braced: string | undefined, bare: string | undefined) =>
    known.get(braced ?? bare!) ?? match)
}

function unquote(v: string): string {
  const q = v[0]
  if (v.length >= 2 && (q === '"' || q === '\'') && v[v.length - 1] === q) {
    return v.slice(1, -1)
  }
  return v
}

export function readDdevConfig(checkoutDir: string): DdevConfigFile | null {
  const text = checkoutReader(checkoutDir)('.ddev/config.yaml')
  return text === null ? null : parseDdevConfig(text)
}

// The repo's tracked config, not Knecht's override.
export interface DdevHosts {
  primary: string | null
  all: string[]
}

export function readDdevHosts(checkoutDir: string): DdevHosts {
  const cfg = readDdevConfig(checkoutDir)
  if (!cfg || cfg.generated) return { primary: null, all: [] }
  return { primary: cfg.hosts[0] ?? null, all: cfg.hosts }
}
