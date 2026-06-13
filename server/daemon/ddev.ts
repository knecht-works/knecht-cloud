import { readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { parse, stringify } from 'yaml'
import type { EnvVar } from '../db/schema'
import { runEnvName, runWorktreeDir } from '../utils/storage'

// Write the per-run ddev override (`.ddev/config.knecht.yaml`). ddev merges all
// `.ddev/config.*.yaml` files, so this adds two things without touching the
// repo's tracked config.yaml:
//   - `name`: a unique per-run name so this worktree boots its OWN containers
//     (the isolation), without colliding on the repo's name.
//   - `web_environment`: the project's configured env vars (projects.md §4),
//     used VERBATIM — no rewriting. YAML sidesteps the comma-escaping of
//     `ddev config --web-environment`.
// Returns how many env vars were written.
export function writeDdevConfig(checkoutDir: string, name: string, envVars: EnvVar[]): number {
  const doc: { name: string, web_environment?: string[] } = { name }
  if (envVars.length) {
    doc.web_environment = envVars.map(e => `${e.key}=${e.value}`)
  }
  writeFileSync(join(checkoutDir, '.ddev', 'config.knecht.yaml'), stringify(doc))
  return envVars.length
}

// The repo's own ddev host, read from the tracked `.ddev/config.yaml` (NOT our
// override). This is the host the pasted .env points at and the booted app
// generates URLs for — what the proxy sends as Host and rewrites in responses.
export function readDdevHost(checkoutDir: string): string | null {
  try {
    const cfg = parse(readFileSync(join(checkoutDir, '.ddev', 'config.yaml'), 'utf8')) as {
      name?: string
      project_tld?: string
    }
    return cfg?.name ? `${cfg.name}.${cfg.project_tld || 'ddev.site'}` : null
  }
  catch {
    return null
  }
}

// Tear down a run's isolated environment: delete the ddev project (containers +
// volumes, no snapshot) and remove its git worktree. Both steps are best-effort
// so a half-gone env still gets cleaned up. `baseDir` is the project's base
// clone the worktree hangs off.
export async function teardownRun(runId: number, baseDir: string): Promise<void> {
  try {
    await execa('ddev', ['delete', '-Oy', runEnvName(runId)])
  }
  catch {
    // Already deleted or never registered.
  }
  try {
    await execa('git', ['-C', baseDir, 'worktree', 'remove', '--force', runWorktreeDir(runId)])
  }
  catch {
    // Worktree already gone.
  }
}

// Attach the Knecht container to ddev's shared `ddev_default` network so the
// preview proxy can reach each run's web container directly by name
// (`ddev-<project>-web`), bypassing the router (no hostname collisions across
// isolated runs). Idempotent; the network exists once any env has booted.
export async function ensureOnDdevNetwork(): Promise<void> {
  try {
    await execa('docker', ['network', 'connect', 'ddev_default', hostname()])
  }
  catch {
    // Already connected, or the network doesn't exist yet — fine either way.
  }
}
