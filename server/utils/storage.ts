import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Knecht's own data directory (SQLite + uploaded DB dumps). Configurable so the
// container can point it at a persistent volume; defaults to a local folder.
export function dataDir(): string {
  return resolve(process.env.KNECHT_DATA_DIR || '.data')
}

// The fixed project path — mounted byte-identically inside and outside the
// container so ddev's host-resolved bind mounts line up (dood-harness.md §3).
// MUST match KNECHT_PROJECTS in compose. Production: /data/knecht/projects;
// macOS/OrbStack: a path under $HOME (SIP seals /data).
export function projectsDir(): string {
  return process.env.KNECHT_PROJECTS || '/data/knecht/projects'
}

// The per-project base clone. Each run gets its own git worktree off this, so
// the clone's object store is shared but every run has an isolated working dir.
export function projectCheckoutDir(project: { id: number, name: string }): string {
  const slug = project.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return join(projectsDir(), `${project.id}-${slug}`)
}

// A run's isolated working directory (a detached git worktree off the project's
// base clone) — its own ddev environment boots here.
export function runWorktreeDir(runId: number): string {
  return join(projectsDir(), `run-${runId}`)
}

// The ddev project name for a run's isolated environment. Overriding the name
// (via .ddev/config.knecht.yaml) is what gives each run its own containers and
// `*.ddev.site` hostname instead of colliding on the repo's committed name.
export function runEnvName(runId: number): string {
  return `knecht-run-${runId}`
}

// Per-project folder for uploaded DB dumps (created on demand).
export function projectDumpDir(projectId: number): string {
  const dir = join(dataDir(), 'dumps', String(projectId))
  mkdirSync(dir, { recursive: true })
  return dir
}

// Strip anything that could escape the dump folder (path traversal, odd chars).
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'dump'
}
