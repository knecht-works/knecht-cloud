import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Knecht's own data directory (SQLite + uploaded DB dumps). Configurable so the
// container can point it at a persistent volume; defaults to a local folder.
export function dataDir(): string {
  return resolve(process.env.KNECHT_DATA_DIR || '.data')
}

// The fixed project path. When Knecht runs as a container it MUST be mounted
// byte-identically inside and out (KNECHT_PROJECTS in compose): the HOST
// daemon resolves the checkout bind mount when a sandbox is launched, so the
// path Knecht passes has to exist on the host. Default: /data/knecht/projects.
export function projectsDir(): string {
  return process.env.KNECHT_PROJECTS || '/data/knecht/projects'
}

// A run's isolated working directory (a self-contained shallow clone): its own
// ddev environment boots here.
export function runCheckoutDir(runId: number): string {
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

// A run's archive folder: the small artifacts (DB export, checkout patch) that
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

// Per-project root for shared folders (projects.sharedFolders): each configured
// project-relative path is backed by a subdir here and bind-mounted writable
// into every run's web container. Lives in the data dir (same-path convention,
// survives run teardown/GC); only the GC for DELETED projects removes it.
export function projectSharedDir(projectId: number): string {
  return join(dataDir(), 'shared', String(projectId))
}

// Normalize a project-relative shared folder path ('./web/uploads/' →
// 'web/uploads'); null when it is empty, absolute, escapes the project root,
// or targets git/ddev/agent internals (those must stay per-run).
export function normalizeSharedFolder(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, '/')
  if (!trimmed || trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) return null
  const parts = trimmed.split('/').filter(p => p && p !== '.')
  if (!parts.length || parts.includes('..')) return null
  if (['.git', '.ddev', '.knecht'].includes(parts[0]!)) return null
  return parts.join('/')
}
