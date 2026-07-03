import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { EnvVar } from '../../shared/utils/env'

// Write the per-run ddev override (`.ddev/config.knecht.yaml`). ddev merges all
// `.ddev/config.*.yaml` files, so this injects two things without touching the
// repo's tracked config.yaml:
//   - `web_environment`: the project's configured env vars (projects.md §4),
//     used VERBATIM — no rewriting. YAML sidesteps the comma-escaping of
//     `ddev config --web-environment`.
//   - `router_http(s)_port`: pinned back to 80/443. Projects override these as
//     HOST-port-collision workarounds (e.g. 8080), but inside a per-run
//     sandbox there is nothing to collide with — and the ingress proxies to
//     the router at :80.
// Everything else — name, hostnames, the URLs in the env vars — stays exactly
// as the repo ships it: each run has its own daemon now, so nothing collides,
// and the preview proxy maps the project's own hostnames to per-run preview
// origins instead of touching the project. Returns how many env vars were
// written.
export function writeDdevConfig(checkoutDir: string, envVars: EnvVar[]): number {
  const doc: {
    web_environment?: string[]
    router_http_port?: string
    router_https_port?: string
  } = { router_http_port: '80', router_https_port: '443' }
  if (envVars.length) {
    // Strip a layer of surrounding quotes — a value like `"https://x"` (quotes
    // stored verbatim) breaks ddev's generated docker-compose YAML. Defensive:
    // covers projects whose env vars were saved before the parser stripped them.
    doc.web_environment = envVars.map(e => `${e.key}=${unquote(e.value)}`)
  }
  writeFileSync(join(checkoutDir, '.ddev', 'config.knecht.yaml'), stringify(doc))
  return envVars.length
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
// pasted .env points at (Craft multisite: one per site) — the preview proxy
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
