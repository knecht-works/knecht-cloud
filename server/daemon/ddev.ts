import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { EnvVar } from '../../shared/utils/env'
import { resolveEnv, type EnvOverrides, type ResolvedEnv } from '../../shared/utils/env-spec'
import { previewHostname, previewLabel } from '../../shared/utils/preview-host'
import { checkoutReader, detectEnv, GENERATED_MARKER, parseDdevConfig, type DdevConfigFile } from '../utils/env-detect'
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
// boot). Returns the resolved env for the run log, the detectors' warnings
// and how many env vars were injected.
export function configureSessionEnv(checkoutDir: string, project: SessionEnvProject, sessionId: number, urlMode: UrlMode): { env: ResolvedEnv, warnings: string[], injected: number } {
  const detected = detectEnv(checkoutReader(checkoutDir))
  const env = resolveEnv(detected, project)
  const injected = writeDdevConfig(checkoutDir, {
    sessionId,
    env,
    envVars: project.envVars,
    urlMode,
    shared: { projectId: project.id, folders: project.sharedFolders },
  })
  return { env, warnings: detected.warnings, injected }
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
// resolved spec, and ddev's settings management off so it never writes
// framework files into the checkout.
//
// Every project then gets the per-run overrides (`.ddev/config.knecht.yaml`,
// `.ddev/docker-compose.knecht.yaml` and, for stacks with a db,
// `.ddev/mysql/00-knecht-lowmem.cnf`). ddev merges all `.ddev/config.*.yaml`
// and `.ddev/docker-compose.*.yaml` files, so this injects everything
// run-specific without touching the repo's tracked config:
//   - `name`: knecht-run-<id>. All runs share ONE docker daemon, so container/
//     volume/network names must be unique per run; nothing routes by hostname
//     (the router is omitted, the preview proxy targets the web container's IP
//     directly), so the project's own hostnames stay valid inward and the
//     rename is invisible to the app.
//   - `web_environment`: the project's configured env vars (projects.md §4).
//     In 'env' urlMode (the default) every ddev-host URL in the VALUES is
//     translated to its per-run preview origin, so a project that derives all
//     its URLs from the env natively renders preview links and the proxy can
//     pass responses through untouched. In 'rewrite' mode the values go in
//     VERBATIM and the proxy maps the two worlds per response. YAML sidesteps
//     the comma-escaping of `ddev config --web-environment`.
//   - compose override: the web container joins the `knecht-ingress` network
//     (how the preview proxy reaches it), gets the agent tools (opencode +
//     knecht-git) bind-mounted read-only from the host tools dir, the
//     project's shared folders bind-mounted writable, and web/db get
//     memory/pid caps.
// The hostnames and the URLs in the env vars stay exactly as the repo ships
// them; the preview proxy maps the project's own hostnames to per-run preview
// origins instead of touching the project. Returns how many env vars were
// written.
export function writeDdevConfig(checkoutDir: string, { sessionId, env, envVars, urlMode, shared }: DdevConfigInput): number {
  const ddevDir = join(checkoutDir, '.ddev')
  if (env.source === 'generated') {
    mkdirSync(ddevDir, { recursive: true })
    writeFileSync(join(ddevDir, 'config.yaml'), `${GENERATED_MARKER}\n` + stringify({
      name: sessionSandboxName(sessionId),
      type: 'php',
      docroot: '',
      webserver_type: 'generic',
      php_version: env.phpVersion.value,
      nodejs_version: env.nodeVersion.value,
      omit_containers: ['db'],
      disable_settings_management: true,
    }))
  }
  const doc: {
    name: string
    web_environment?: string[]
  } = { name: sessionSandboxName(sessionId) }
  if (envVars.length) {
    const translate = urlMode === 'env'
      ? envUrlTranslator(env.hosts.value, sessionId)
      : (v: string) => v
    // Strip a layer of surrounding quotes: a value like `"https://x"` (quotes
    // stored verbatim) breaks ddev's generated docker-compose YAML. Defensive:
    // covers projects whose env vars were saved before the parser stripped them.
    doc.web_environment = envVars.map(e => `${e.key}=${translate(unquote(e.value))}`)
  }
  // The marker comment silences ddev's "custom configuration detected"
  // warning, which would otherwise open every run log.
  const marker = '#ddev-silent-no-warn\n'
  writeFileSync(join(ddevDir, 'config.knecht.yaml'), marker + stringify(doc))
  writeFileSync(join(ddevDir, 'docker-compose.knecht.yaml'), marker + stringify(composeOverride(env.hasDb.value, shared ? sharedFolderMounts(shared) : [])))
  if (env.hasDb.value) writeLowmemDbConfig(checkoutDir, marker)
  return envVars.length
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
function writeLowmemDbConfig(checkoutDir: string, marker: string): void {
  const dir = join(checkoutDir, '.ddev', 'mysql')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '00-knecht-lowmem.cnf'), `${marker}[mysqld]
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
function composeOverride(hasDb: boolean, sharedMounts: { host: string, dest: string }[] = []): Record<string, unknown> {
  const tools = toolsDir()
  const toolMounts = [
    { host: join(tools, 'opencode'), dest: '/usr/local/bin/opencode' },
    { host: join(tools, 'knecht-git'), dest: '/usr/local/bin/knecht-git' },
    { host: join(tools, 'knecht-reply'), dest: '/usr/local/bin/knecht-reply' },
    { host: join(tools, 'knecht-label'), dest: '/usr/local/bin/knecht-label' },
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
