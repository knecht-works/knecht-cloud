import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { EnvVar } from '../../shared/utils/env'
import { runSandboxName, toolsDir } from '../utils/storage'

// Per-container resource caps (compose mem_limit/pids_limit): all runs share
// the host daemon now, so one runaway build or query must not take the box
// down. Generous enough for real project builds.
const WEB_MEM_LIMIT = '2g'
const DB_MEM_LIMIT = '1g'
const WEB_PIDS_LIMIT = 2048

// Write the per-run ddev overrides (`.ddev/config.knecht.yaml` plus
// `.ddev/docker-compose.knecht.yaml`). ddev merges all `.ddev/config.*.yaml`
// and `.ddev/docker-compose.*.yaml` files, so this injects everything
// run-specific without touching the repo's tracked config:
//   - `name`: knecht-run-<id>. All runs share ONE docker daemon, so container/
//     volume/network names must be unique per run; nothing routes by hostname
//     (the router is omitted, the preview proxy targets the web container's IP
//     directly), so the project's own hostnames stay valid inward and the
//     rename is invisible to the app.
//   - `web_environment`: the project's configured env vars (projects.md §4),
//     used VERBATIM: no rewriting. YAML sidesteps the comma-escaping of
//     `ddev config --web-environment`.
//   - compose override: the web container joins the `knecht-ingress` network
//     (how the preview proxy reaches it), gets the agent tools (opencode +
//     knecht-git) bind-mounted read-only from the host tools dir, and web/db
//     get memory/pid caps.
// The hostnames and the URLs in the env vars stay exactly as the repo ships
// them; the preview proxy maps the project's own hostnames to per-run preview
// origins instead of touching the project. Returns how many env vars were
// written.
export function writeDdevConfig(checkoutDir: string, envVars: EnvVar[], runId: number): number {
  const doc: {
    name: string
    web_environment?: string[]
  } = { name: runSandboxName(runId) }
  if (envVars.length) {
    // Strip a layer of surrounding quotes: a value like `"https://x"` (quotes
    // stored verbatim) breaks ddev's generated docker-compose YAML. Defensive:
    // covers projects whose env vars were saved before the parser stripped them.
    doc.web_environment = envVars.map(e => `${e.key}=${unquote(e.value)}`)
  }
  // The marker comment silences ddev's "custom configuration detected"
  // warning, which would otherwise open every run log.
  const marker = '#ddev-silent-no-warn\n'
  writeFileSync(join(checkoutDir, '.ddev', 'config.knecht.yaml'), marker + stringify(doc))
  writeFileSync(join(checkoutDir, '.ddev', 'docker-compose.knecht.yaml'), marker + stringify(composeOverride()))
  return envVars.length
}

// The compose override ddev merges into the project's generated stack. Tool
// mounts are host paths, so they only work because the tools dir follows the
// same-path convention (mounted byte-identically into the Knecht container);
// each mount is included only when the file actually exists: a missing bind
// source would make docker create a root-owned DIRECTORY in its place.
function composeOverride(): Record<string, unknown> {
  const tools = toolsDir()
  const toolMounts = [
    { host: join(tools, 'opencode'), dest: '/usr/local/bin/opencode' },
    { host: join(tools, 'knecht-git'), dest: '/usr/local/bin/knecht-git' },
    // Shadows the stock in-container ddev shim, which silently no-ops
    // (`ddev composer install` would exit 0 without installing anything).
    { host: join(tools, 'ddev-shim'), dest: '/usr/local/bin/ddev' },
  ].filter(m => existsSync(m.host))
  return {
    services: {
      web: {
        mem_limit: WEB_MEM_LIMIT,
        pids_limit: WEB_PIDS_LIMIT,
        // Mapping form (not the list form): ddev's generated compose declares
        // service networks as a mapping, and compose refuses to merge the two
        // shapes.
        networks: { 'knecht-ingress': {} },
        ...(toolMounts.length
          ? { volumes: toolMounts.map(m => `${m.host}:${m.dest}:ro`) }
          : {}),
      },
      db: { mem_limit: DB_MEM_LIMIT },
    },
    networks: {
      'knecht-ingress': { external: true },
    },
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
