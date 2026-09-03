import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type AddressInfo, type Server } from 'node:net'
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { EnvVar } from '../../shared/utils/env'
import { resolveEnv, type EnvOverrides, type ResolvedEnv } from '../../shared/utils/env-spec'
import { PREVIEW_FORWARD_PORT, previewHostname, previewLabel } from '../../shared/utils/preview-host'
import { checkoutReader, detectEnv, GENERATED_MARKER, parseDdevConfig, type DdevConfigFile } from '../utils/env-detect'
import { sessionEnv } from '../utils/knecht-env'
import { dashboardOrigin } from '../utils/origin'
import { normalizeSharedFolder, projectSharedDir, sessionSandboxName, toolsDir } from '../utils/storage'
import { WEB_PROJECT_DIR } from './sandbox'

export type UrlMode = 'env' | 'rewrite'

// Per-container resource caps (compose mem_limit/pids_limit): all runs share
// the host daemon now, so one runaway build or query must not take the box
// down. Generous enough for real project builds.
const WEB_MEM_LIMIT = '2g'
const DB_MEM_LIMIT = '1g'
const WEB_PIDS_LIMIT = 2048

// The dev server of a generated environment (projects.devServer) runs under
// ddev's supervisord as an extra daemon, on the toolchain the ddev image
// ships (PHP, Node at nodejs_version, Composer, npm, plus pnpm and yarn via
// Corepack; bun is added to the image when the repo uses it).
export const DEV_DAEMON_GROUP = 'webextradaemons'

// A dev server started with its defaults binds localhost only, which the
// preview proxy cannot reach from outside the container. So next to the dev
// server runs `knecht-forward` (sandbox/knecht-forward, mounted with the
// other tools), which accepts on every interface at PREVIEW_FORWARD_PORT and
// forwards to 127.0.0.1:<previewPort>. Everything that talks to a session's
// dev server from the host targets that port, never the pinned one: the
// forwarder for a dev server (the session has a pinned previewPort), the
// web server's :80 for a repo with its own ddev config.
export function previewTargetPort(previewPort: number | null): number {
  return previewPort == null ? 80 : PREVIEW_FORWARD_PORT
}

// ddev mounts one host-wide cache volume into every web container and already
// points Composer, npm and Corepack at it. These point the other package
// managers there too, so a host downloads every package once and later
// installs run from the cache. pnpm 9 and 10 only read the npm-style name,
// which makes npm itself warn about an unknown option on every call, so that
// one is reserved for repos that use pnpm.
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

// Derive a session's environment from its checkout plus the project's
// settings and write the ddev files for it. THE entry point for every boot
// (first run, reboot, restore): detection runs against the checkout every
// time and nothing about the spec is stored, so the checkout and the settings
// stay the only truth (a committed `.ddev/config.yaml` takes over on the next
// boot). Returns the resolved env for the run log, the detectors' warnings,
// how many env vars were injected, the port a dev server daemon was
// actually written for (null: none), and whether any of the files differ
// from what the checkout had before (so a caller with a running container
// knows it was built from an older definition). The caller pins the port on
// the session right away: the preview proxy and the boot's restart read the
// pin live, and it must describe the container that was just built, not a
// setting from an earlier boot.
export interface SessionEnvResult {
  env: ResolvedEnv
  warnings: string[]
  injected: number
  devServerPort: number | null
  changed: boolean
}

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

// Write the per-session ddev files into the checkout.
//
// A repo WITHOUT its own `.ddev/config.yaml` (env.source 'generated') first
// gets one, marked with GENERATED_MARKER so the next boot and git.ts recognize
// it as Knecht's: a plain `php` project with NO web server (webserver_type
// generic: php-cli, composer and node are there, nginx/php-fpm are not started
// for a repo that has no website), no db container, php/node pinned from the
// resolved spec, Corepack enabled so pnpm and yarn work, bun added to the web
// image when the repo uses it, and ddev's settings management off so it never
// writes framework files into the checkout.
//
// Every project then gets the per-run overrides (KNECHT_CONFIG_FILE,
// KNECHT_COMPOSE_FILE and, for stacks with a db,
// `.ddev/mysql/00-knecht-lowmem.cnf`). ddev merges all `.ddev/config.*.yaml`
// and `.ddev/docker-compose.*.yaml` files in name order, so this injects
// everything run-specific without touching the repo's tracked config:
//   - `name`: knecht-run-<id>. All runs share ONE docker daemon, so container/
//     volume/network names must be unique per run; nothing routes by hostname
//     (the router is omitted, the preview proxy targets the web container's IP
//     directly), so the project's own hostnames stay valid inward and the
//     rename is invisible to the app.
//   - `web_environment`: the project's configured env vars (projects.md §4)
//     plus the session's KNECHT_* variables (utils/knecht-env.ts) whenever
//     the environment has a preview to point at, plus ddev's own URL
//     variables (ddevUrlEnv). A value may reference one of those or an
//     earlier line as `$NAME` / `${NAME}`, the way a .env file expands; a
//     name nothing defines stays as written.
//     In 'env' urlMode (the default) every ddev-host URL in the VALUES is
//     translated to its per-run preview origin, so a project that derives all
//     its URLs from the env natively renders preview links and the proxy can
//     pass responses through untouched. In 'rewrite' mode the values go in
//     VERBATIM and the proxy maps the two worlds per response. YAML sidesteps
//     the comma-escaping of `ddev config --web-environment`. The package
//     manager cache paths (PACKAGE_CACHE_ENV) follow the project's vars.
//   - `host_*_port`: a host port Knecht probes free right before writing, so
//     docker binds it. A repo may pin `host_db_port: 3306` for a developer's
//     GUI client; nothing here needs a fixed host port (everything reaches
//     the containers over the network), so this overrides that pin the same
//     way for every project. ddev ignores an EMPTY override for these (empty
//     means unset in its merge), so the override must carry a real number:
//     ddev's OWN port bookkeeping (global config's used-host-ports list)
//     treats any literal value as an actually reserved port and rejects a
//     second project reusing it, so a shared placeholder like "0" for every
//     session collides across parallel runs exactly like the repo's pinned
//     port did.
//   - `XDEBUG_MODE=off` in the environment: a repo with `xdebug_enabled:
//     true` makes every request wait for a debugger on host.docker.internal
//     that nothing runs. ddev's merge ignores `xdebug_enabled: false` (a zero
//     value), while the env variable outranks the ini ddev writes, for
//     php-fpm and the CLI alike. A project's own XDEBUG_MODE line wins.
//   - compose override: the web container joins the `knecht-ingress` network
//     (how the preview proxy reaches it), gets the agent tools (opencode +
//     knecht-git) bind-mounted read-only from the host tools dir, the
//     project's shared folders bind-mounted writable, and web/db get
//     memory/pid caps.
// The hostnames and the URLs in the env vars stay exactly as the repo ships
// them; the preview proxy maps the project's own hostnames to per-run preview
// origins instead of touching the project. Returns how many env vars were
// written, the dev server's port when its daemon was written, and whether
// any file differs from the checkout's previous state (every write below
// goes through syncFile/removeFile, which only touch a file that differs).
// The per-run override files. ddev merges `config.*.yaml` and
// `docker-compose.*.yaml` in name order and the last file wins for a scalar,
// so a repo's own committed override (`config.vite.yaml`, an add-on's
// compose file) must sort BEFORE Knecht's: the `zzz-` prefix puts Knecht last,
// and what it sets (the name, the environment, the ingress network) holds.
export const KNECHT_CONFIG_FILE = 'config.zzz-knecht.yaml'
export const KNECHT_COMPOSE_FILE = 'docker-compose.zzz-knecht.yaml'

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
  // Strip a layer of surrounding quotes: a value like `"https://x"` (quotes
  // stored verbatim) breaks ddev's generated docker-compose YAML. Defensive:
  // covers projects whose env vars were saved before the parser stripped them.
  // Every `$` still there after the references are expanded is escaped for
  // docker compose, which would otherwise interpolate it against the HOST
  // environment and turn an unset name into an empty string.
  // A repo's own ddev config serves its hosts, a generated environment only
  // serves anything through its dev server: without either there is no
  // preview and the session variables would point at nothing. The same rule
  // hasPreviewTarget (utils/preview-target.ts) applies to project rows.
  const hasPreview = env.source === 'ddev' || devServer !== null
  const session = hasPreview ? sessionEnv(sessionId, env.hosts.value) : {}
  Object.assign(session, ddevUrlEnv(env.hosts.value, session.KNECHT_PREVIEW_URL, translate), { XDEBUG_MODE: 'off' })
  const known = new Map(Object.entries(session))
  const environment: string[] = []
  for (const e of envVars) {
    const value = translate(expandEnvRefs(unquote(e.value), known))
    known.set(e.key, value)
    environment.push(`${e.key}=${value.replace(/\$/g, () => '$$')}`)
  }
  // A project's own line for a session variable wins: written on purpose.
  environment.push(...Object.entries(session)
    .filter(([key]) => !envVars.some(e => e.key === key))
    .map(([key, value]) => `${key}=${value}`))
  environment.push(...PACKAGE_CACHE_ENV)
  if (env.packageManager.value.name === 'pnpm') environment.push(PNPM_LEGACY_STORE_ENV)
  if (devServer !== null) {
    // Vite reads the preview host from __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS
    // (5.4.12/6.0.9 and up), so an untouched Vite project serves the preview
    // without putting KNECHT_PREVIEW_URL into its allowedHosts itself.
    const preview = session.KNECHT_PREVIEW_URL
    if (preview) environment.push(`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=${new URL(preview).hostname}`)
    doc.web_extra_daemons = [
      { name: 'dev', command: devDaemonCommand(devServer.command), directory: WEB_PROJECT_DIR },
      { name: 'forward', command: `knecht-forward ${PREVIEW_FORWARD_PORT} ${devServer.port}`, directory: WEB_PROJECT_DIR },
    ]
  }
  if (environment.length) doc.web_environment = environment
  // The marker comment silences ddev's "custom configuration detected"
  // warning, which would otherwise open every run log.
  const marker = '#ddev-silent-no-warn\n'
  changed = syncKnechtConfig(join(ddevDir, KNECHT_CONFIG_FILE), marker + stringify(doc)) || changed
  changed = syncFile(join(ddevDir, KNECHT_COMPOSE_FILE), marker + stringify(composeOverride({
    hasDb: env.hasDb.value,
    sharedMounts: shared ? sharedFolderMounts(shared) : [],
  }))) || changed
  if (env.hasDb.value) changed = writeLowmemDbConfig(checkoutDir, marker) || changed
  return { injected: envVars.length, devServerPort: devServer?.port ?? null, changed }
}

// ddev derives DDEV_PRIMARY_URL, DDEV_HOSTNAME and DDEV_SCHEME from its
// router and leaves ALL of them empty when the router is omitted, which it is
// on every Knecht host. A project that builds its URLs from them (ddev's own
// settings files for Drupal, TYPO3 and WordPress do) would point nowhere. So
// they are written here the way ddev writes them locally, from the repo's
// ddev hostnames (a generated environment has none: its preview is the
// primary), and they follow the urlMode like the project's own variables:
// translated to the preview origins in 'env' mode, verbatim in 'rewrite'
// mode, where the proxy maps them per response. Port and scheme come from
// the resulting primary URL, so they match what the browser actually uses.
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

// Write `text` to `path` unless the file already holds it; true when the
// file was created or its content differs.
function syncFile(path: string, text: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false
  writeFileSync(path, text)
  return true
}

// True when there was a file to remove.
function removeFile(path: string): boolean {
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}

// Like syncFile, but the host_*_port lines never count towards `changed`:
// they get a freshly probed value on every write (below), and nothing reads
// them back (the preview proxy reaches the container directly over the
// ingress network, never through a published host port), so a run's own
// idle-reboot restart logic must not fire just because the number moved.
const HOST_PORT_LINE = /^(host_(?:db|webserver|https|mailpit)_port: ).*$/gm
function syncKnechtConfig(path: string, text: string): boolean {
  const mask = (s: string) => s.replace(HOST_PORT_LINE, '$1<port>')
  const prior = existsSync(path) ? readFileSync(path, 'utf8') : null
  writeFileSync(path, text)
  return prior === null || mask(prior) !== mask(text)
}

// `count` distinct ports currently free on the host, the way ddev's own
// unset-port default picks one (net.Listen(":0"), read back the assigned
// port). Every socket stays open until all of them are bound, so probing the
// next one can never land on a port this same batch just released.
function freeHostPorts(count: number): Promise<number[]> {
  return Promise.all(Array.from({ length: count }, () => new Promise<Server>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  }))).then((servers) => {
    const ports = servers.map(server => (server.address() as AddressInfo).port)
    servers.forEach(server => server.close())
    return ports
  })
}

// The dev server an environment runs, or null: only generated environments
// (a repo's own ddev config serves its site itself), and only a command
// together with the port the preview proxy targets. The ONE gate behind the
// daemon, its image files and the port pinned on the session.
function devServerFor(env: ResolvedEnv): { command: string, port: number } | null {
  if (env.source !== 'generated' || !env.devServer.value || env.previewPort.value === null) return null
  return { command: env.devServer.value, port: env.previewPort.value }
}

// The supervisord program line for the dev server. ddev wraps the value in
// `bash -c "<command>; ..."` (double quotes), and the project's command runs
// under `bash -lc` so the login shell applies the image's profile and any
// homeadditions hooks the repo ships. Both quoting layers are escaped here,
// so a command with quotes or `$` survives.
export function devDaemonCommand(devServer: string): string {
  const inner = `bash -lc '${devServer.replace(/'/g, `'\\''`)}'`
  return inner.replace(/[\\"$`]/g, m => `\\${m}`)
}

// bun is not in ddev's web image. ddev appends every `.ddev/web-build/
// Dockerfile.*` to the project's image build, and bun is an npm package with
// a prebuilt binary, so one `npm install -g` line adds it; Docker caches the
// layer, so only the first bun session on a host downloads it. A repo that
// does not use bun loses the file from an earlier boot, so no stale layer
// survives a switch back to npm.
function writeBunImageFile(ddevDir: string, env: ResolvedEnv): boolean {
  const dockerfile = join(ddevDir, 'web-build', 'Dockerfile.knecht')
  const { name, version } = env.packageManager.value
  if (name !== 'bun') return removeFile(dockerfile)
  mkdirSync(join(ddevDir, 'web-build'), { recursive: true })
  return syncFile(dockerfile, `RUN npm install -g bun@${version ?? 'latest'}\n`)
}

// ddev's db image ships a my.cnf sized for ONE comfortable dev machine
// (1 GB InnoDB buffer pool, performance_schema on, 100 connections): every db
// container settles around 500 MB, which is what caps how many previews fit
// on a host. Preview traffic is one person clicking through a CMS, so shrink
// the caches via the `.ddev/mysql` includedir (applies to MySQL AND MariaDB;
// a Postgres project never reads the dir, and Postgres is frugal by default).
// The `00-` prefix makes this load FIRST, so a project that ships its own
// deliberate `.ddev/mysql` tuning overrides ours, not the other way around.
// 256M pool: barely-more RSS for small DBs (pool pages allocate on demand)
// but keeps multi-GB dump imports and previews reasonable.
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

// The writable bind mounts for the project's shared folders: one persistent
// host dir per configured project-relative path, shared by ALL of the
// project's runs (a CMS upload in one preview shows up in every other run).
// The host dirs are created here, by the Knecht process: a missing bind
// source would make docker create them root-owned, unwritable for the app.
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

// The compose override ddev merges into the project's generated stack. Tool
// mounts are host paths, so they only work because the tools dir follows the
// same-path convention (mounted byte-identically into the Knecht container);
// each mount is included only when the file actually exists: a missing bind
// source would make docker create a root-owned DIRECTORY in its place. The db
// cap is only written for stacks that have a db: a service entry without an
// image is a compose error when ddev omits the container.
function composeOverride({ hasDb, sharedMounts }: { hasDb: boolean, sharedMounts: { host: string, dest: string }[] }): Record<string, unknown> {
  const tools = toolsDir()
  const toolMounts = [
    { host: join(tools, 'opencode'), dest: '/usr/local/bin/opencode' },
    { host: join(tools, 'knecht-git'), dest: '/usr/local/bin/knecht-git' },
    { host: join(tools, 'knecht-reply'), dest: '/usr/local/bin/knecht-reply' },
    { host: join(tools, 'knecht-label'), dest: '/usr/local/bin/knecht-label' },
    { host: join(tools, 'knecht-forward'), dest: '/usr/local/bin/knecht-forward' },
    // Sourced by knecht-reply/knecht-label, not on PATH.
    { host: join(tools, 'knecht-bridge-lib'), dest: '/usr/local/lib/knecht-bridge-lib' },
    // Shadows the stock in-container ddev shim, which silently no-ops
    // (`ddev composer install` would exit 0 without installing anything).
    { host: join(tools, 'ddev-shim'), dest: '/usr/local/bin/ddev' },
    // The web IDE server (a directory, staged by daemon/ide.ts); started on
    // demand from the run page, idle otherwise.
    { host: join(tools, 'openvscode-server'), dest: '/usr/local/lib/openvscode-server' },
  ].filter(m => existsSync(m.host))
  const volumes = [
    ...toolMounts.map(m => `${m.host}:${m.dest}:ro`),
    // Shared folders are writable: uploads made in a preview must land on the
    // persistent host dir.
    ...sharedMounts.map(m => `${m.host}:${m.dest}`),
  ]
  return {
    services: {
      web: {
        mem_limit: WEB_MEM_LIMIT,
        pids_limit: WEB_PIDS_LIMIT,
        // Mapping form (not the list form): ddev's generated compose declares
        // service networks as a mapping, and compose refuses to merge the two
        // shapes.
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

// Build the env-value translator for 'env' urlMode: every occurrence of a
// project ddev host in an env VALUE becomes its per-run preview form. URL
// forms (`https://host`, `http://host`) become the full preview origin
// (scheme and port from the dashboard origin, since previews share its entry
// point); a remaining bare host (e.g. a cookie-domain var) becomes the bare
// preview hostname. Longest host first, so a host containing another as a
// suffix is never half-translated. Without a configured base origin there is
// nothing to translate towards; values pass through unchanged.
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
        // URL forms need the full origin (scheme + port); a remaining bare
        // host (e.g. a cookie-domain var) must stay a plain hostname.
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

// Expand `$NAME` and `${NAME}` from `known`; a name it does not hold stays
// as written (a literal `$` in a password must survive).
function expandEnvRefs(value: string, known: Map<string, string>): string {
  return value.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (match, braced: string | undefined, bare: string | undefined) =>
    known.get(braced ?? bare!) ?? match)
}

// Strip one layer of matching surrounding quotes (standard .env semantics).
function unquote(v: string): string {
  const q = v[0]
  if (v.length >= 2 && (q === '"' || q === '\'') && v[v.length - 1] === q) {
    return v.slice(1, -1)
  }
  return v
}

// The checkout's `.ddev/config.yaml`, tracked or generated, or null when
// there is none (yet). What the lifecycle reads back after a boot: whether the
// stack has a db to export/import, whether the config is Knecht's own.
export function readDdevConfig(checkoutDir: string): DdevConfigFile | null {
  const text = checkoutReader(checkoutDir)('.ddev/config.yaml')
  return text === null ? null : parseDdevConfig(text)
}

// ALL hostnames the project's ddev environment serves, read from the tracked
// `.ddev/config.yaml` (NOT our override): the primary `<name>.<tld>` plus
// every additional_hostnames/additional_fqdns entry. These are the hosts the
// pasted .env points at (Craft multisite: one per site); the preview proxy
// gives each one its own per-run preview origin and maps between the two. A
// config Knecht generated serves no hostname of its own: empty, so the proxy
// falls back to passing the preview host through.
export interface DdevHosts {
  primary: string | null
  all: string[]
}

export function readDdevHosts(checkoutDir: string): DdevHosts {
  const cfg = readDdevConfig(checkoutDir)
  if (!cfg || cfg.generated) return { primary: null, all: [] }
  return { primary: cfg.hosts[0] ?? null, all: cfg.hosts }
}
