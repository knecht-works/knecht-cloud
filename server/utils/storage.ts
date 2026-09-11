import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export function dataDir(): string {
  return resolve(process.env.KNECHT_DATA_DIR || '.data')
}

// Must be mounted at the same path inside and outside the Knecht container:
// the host daemon resolves the checkout bind mount from this path.
export function projectsDir(): string {
  return process.env.KNECHT_PROJECTS || '/data/knecht/projects'
}

// The `run-` prefix names the SESSION id; renaming would orphan existing checkouts.
export function sessionCheckoutDir(sessionId: number): string {
  return join(projectsDir(), `run-${sessionId}`)
}

export function sessionSandboxName(sessionId: number): string {
  return `knecht-run-${sessionId}`
}

export function toolsDir(): string {
  return join(dataDir(), 'tools')
}

export function sessionArchiveDir(sessionId: number): string {
  return join(dataDir(), 'archives', `run-${sessionId}`)
}

export function projectDumpDir(projectId: number): string {
  const dir = join(dataDir(), 'dumps', String(projectId))
  mkdirSync(dir, { recursive: true })
  return dir
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'dump'
}

export function projectSharedDir(projectId: number): string {
  return join(dataDir(), 'shared', String(projectId))
}

export function normalizeSharedFolder(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, '/')
  if (!trimmed || trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) return null
  const parts = trimmed.split('/').filter(p => p && p !== '.')
  if (!parts.length || parts.includes('..')) return null
  if (['.git', '.ddev', '.knecht'].includes(parts[0]!)) return null
  return parts.join('/')
}
