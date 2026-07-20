import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Knecht's own data directory (SQLite + uploaded DB dumps). Configurable so the
// container can point it at a persistent volume; defaults to a local folder.
export function dataDir(): string {
  return resolve(process.env.KNECHT_DATA_DIR || '.data')
}

// The fixed project path. When Knecht runs as a container it MUST be mounted
// byte-identically inside and out (KNECHT_PROJECTS in compose): the HOST
// daemon resolves the worktree bind mount when a sandbox is launched, so the
// path Knecht passes has to exist on the host. Default: /data/knecht/projects.
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
// base clone): its own ddev environment boots here.
export function runWorktreeDir(runId: number): string {
  return join(projectsDir(), `run-${runId}`)
}

// The name of a run's environment: its ddev project name on the host daemon
// (containers ddev-knecht-run-<id>-web/-db). Everything about a run's
// environment is addressed through this one name. (Pre-DooD installs used the
// same name for the per-run Sysbox container; the teardown still sweeps those.)
export function runSandboxName(runId: number): string {
  return `knecht-run-${runId}`
}

// Host dir the agent tools (the opencode binary, the knecht-git bridge CLI)
// are staged into (server/plugins/agent-tools.ts) and bind-mounted from into
// every run's web container. Lives in the data dir, which follows the
// same-path host/container convention, so the compose bind mounts resolve.
export function toolsDir(): string {
  return join(dataDir(), 'tools')
}

// A run's archive folder: the small artifacts (DB export, worktree patch) that
// survive the env teardown so an archived run can be restored exactly. NOT
// created here: writers mkdir, readers probe.
export function runArchiveDir(runId: number): string {
  return join(dataDir(), 'archives', `run-${runId}`)
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
