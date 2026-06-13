import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Knecht's own data directory (SQLite + uploaded DB dumps). Configurable so the
// container can point it at a persistent volume; defaults to a local folder.
export function dataDir(): string {
  return resolve(process.env.KNECHT_DATA_DIR || '.data')
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
