import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { EnvVar } from '../../shared/utils/env'
import { previewHostname, previewLabel } from '../../shared/utils/preview-host'
import { dashboardOrigin } from '../utils/origin'
import { normalizeSharedFolder, projectSharedDir, runSandboxName, toolsDir } from '../utils/storage'
import { WEB_PROJECT_DIR } from './sandbox'

export type UrlMode = 'env' | 'rewrite'

// Per-container resource caps (compose mem_limit/pids_limit): all runs share
// the host daemon now, so one runaway build or query must not take the box
// down. Generous enough for real project builds.
const WEB_MEM_LIMIT = '2g'
const DB_MEM_LIMIT = '1g'
const WEB_PIDS_LIMIT = 2048

// Write the per-run ddev overrides (`.ddev/config.knecht.yaml`,
// `.ddev/docker-compose.knecht.yaml` and `.ddev/mysql/00-knecht-lowmem.cnf`).
// ddev merges all `.ddev/config.*.yaml` and `.ddev/docker-compose.*.yaml`
// files, so this injects everything run-specific without touching the repo's
// tracked config:
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
export interface SharedFolderConfig {
  projectId: number
  folders: string[]
}

export function writeDdevConfig(checkoutDir: string, envVars: EnvVar[], runId: number, urlMode: UrlMode = 'env', shared?: SharedFolderConfig): number {
  const doc: {
    name: string
    web_environment?: string[]
  } = { name: runSandboxName(runId) }
  if (envVars.length) {
    const translate = urlMode === 'env'
      ? envUrlTranslator(readDdevHosts(checkoutDir), runId)
      : (v: string) => v
    // Strip a layer of surrounding quotes: a value like `"https://x"` (quotes
    // stored verbatim) breaks ddev's generated docker-compose YAML. Defensive:
    // covers projects whose env vars were saved before the parser stripped them.
    doc.web_environment = envVars.map(e => `${e.key}=${translate(unquote(e.value))}`)
  }
  // The marker comment silences ddev's "custom configuration detected"
  // warning, which would otherwise open every run log.
  const marker = '#ddev-silent-no-warn\n'
  writeFileSync(join(checkoutDir, '.ddev', 'config.knecht.yaml'), marker + stringify(doc))
  writeFileSync(join(checkoutDir, '.ddev', 'docker-compose.knecht.yaml'), marker + stringify(composeOverride(shared ? sharedFolderMounts(shared) : [])))
  writeLowmemDbConfig(checkoutDir, marker)
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
// source would make docker create a root-owned DIRECTORY in its place.
function composeOverride(sharedMounts: { host: string, dest: string }[] = []): Record<string, unknown> {
  const tools = toolsDir()
  const toolMounts = [
    { host: join(tools, 'opencode'), dest: '/usr/local/bin/opencode' },
    { host: join(tools, 'knecht-git'), dest: '/usr/local/bin/knecht-git' },
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
      db: { mem_limit: DB_MEM_LIMIT },
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
function envUrlTranslator(hosts: DdevHosts, runId: number): (value: string) => string {
  const base = dashboardOrigin()
  if (!base || !hosts.all.length) return v => v
  const origin = new URL(base)
  const mappings = [...hosts.all]
    .sort((a, b) => b.length - a.length)
    .map((host) => {
      const label = host === hosts.primary ? undefined : previewLabel(host)
      return {
        host,
        // URL forms need the full origin (scheme + port); a remaining bare
        // host (e.g. a cookie-domain var) must stay a plain hostname.
        previewOrigin: `${origin.protocol}//${previewHostname(runId, origin.host, label)}`,
        previewBare: previewHostname(runId, origin.hostname, label),
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

// ALL hostnames the project's ddev environment serves, read from the tracked
// `.ddev/config.yaml` (NOT our override): the primary `<name>.<tld>` plus
// every additional_hostnames/additional_fqdns entry. These are the hosts the
// pasted .env points at (Craft multisite: one per site); the preview proxy
// gives each one its own per-run preview origin and maps between the two.
export interface DdevHosts {
  primary: string | null
  all: string[]
}

export function readDdevHosts(checkoutDir: string): DdevHosts {
  try {
    const cfg = parse(readFileSync(join(checkoutDir, '.ddev', 'config.yaml'), 'utf8')) as {
      name?: string
      project_tld?: string
      additional_hostnames?: string[]
      additional_fqdns?: string[]
    }
    if (!cfg?.name) return { primary: null, all: [] }
    const tld = cfg.project_tld || 'ddev.site'
    const primary = `${cfg.name}.${tld}`
    const all = [
      primary,
      ...(cfg.additional_hostnames ?? []).map(h => `${h}.${tld}`),
      ...(cfg.additional_fqdns ?? []),
    ]
    return { primary, all }
  }
  catch {
    return { primary: null, all: [] }
  }
}
