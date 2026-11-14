import { existsSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execa } from 'execa'
import { listProjects } from '../stores/projects'
import type { DbBase } from '../db/schema'
import { dataDir, projectsDir } from '../utils/storage'
import { ddevWebImage, removeEnvStack } from './sandbox'
import { DB_BASE_PREFIX, dbBaseBuilding } from './db-base'
import { envTransition } from './envs'
import { removeWorkspace, WORKSPACE_LABEL, workspaceContainerName } from './workspace'
import { listSessionIds, listSessionsInEnvState } from '../stores/sessions'
import { deleteToolCallsBefore } from '../stores/tool-calls'

const TOOL_CALL_RETENTION_MS = 90 * 24 * 60 * 60_000

export interface GcResult {
  sandboxes: string[]
  checkouts: string[]
  archives: string[]
  dumpDirs: string[]
  dumpFiles: string[]
  dbBases: string[]
  sharedDirs: string[]
  memoryDirs: string[]
  images: string[]
  dockerPruned: string[]
}

export async function collectGarbage(): Promise<GcResult> {
  const liveSessions = new Set(listSessionIds())
  const projects = listProjects()
  const liveProjects = new Set(projects.map(p => p.id))

  const result: GcResult = { sandboxes: [], checkouts: [], archives: [], dumpDirs: [], dumpFiles: [], dbBases: [], sharedDirs: [], memoryDirs: [], images: [], dockerPruned: [] }
  result.sandboxes = [...await reapOrphanSandboxes(liveSessions), ...await reapOrphanWorkspaces(liveSessions)]
  result.checkouts = reapOrphanCheckouts(liveSessions)
  result.archives = reapOrphanArchives(liveSessions)
  result.dumpDirs = reapOrphanDumpDirs(liveProjects)
  result.dumpFiles = reapStaleDumpFiles(projects)
  result.dbBases = await reapOrphanDbBases(projects)
  result.sharedDirs = reapOrphanSharedDirs(liveProjects)
  result.memoryDirs = reapOrphanMemoryDirs(liveProjects)
  result.images = await reapStaleImages()
  result.dockerPruned = await pruneHostDocker()
  deleteToolCallsBefore(new Date(Date.now() - TOOL_CALL_RETENTION_MS))

  return result
}

async function reapOrphanSandboxes(liveSessions: Set<number>): Promise<string[]> {
  const orphans = new Map<number, string>()
  try {
    const { stdout } = await execa('docker', ['ps', '-a', '--filter', 'label=com.ddev.site-name', '--format', '{{.Label "com.ddev.site-name"}}'])
    for (const line of stdout.split('\n')) {
      const sessionId = Number(line.trim().match(/^knecht-run-(\d+)$/)?.[1])
      if (!sessionId || liveSessions.has(sessionId)) continue
      orphans.set(sessionId, `knecht-run-${sessionId}`)
    }
  }
  catch {
    return []
  }
  const removed: string[] = []
  for (const [sessionId, name] of orphans) {
    await removeEnvStack(sessionId)
    removed.push(name)
  }
  return removed
}

// The network outlives a container that `--rm` removed on a docker restart.
async function reapOrphanWorkspaces(liveSessions: Set<number>): Promise<string[]> {
  const orphans = new Set<number>()
  try {
    const format = `{{.Label "${WORKSPACE_LABEL}"}}`
    const [{ stdout: containers }, { stdout: networks }] = await Promise.all([
      execa('docker', ['ps', '-a', '--filter', `label=${WORKSPACE_LABEL}`, '--format', format]),
      execa('docker', ['network', 'ls', '--filter', `label=${WORKSPACE_LABEL}`, '--format', format]),
    ])
    for (const line of `${containers}\n${networks}`.split('\n')) {
      const sessionId = Number(line.trim())
      if (sessionId && !liveSessions.has(sessionId)) orphans.add(sessionId)
    }
  }
  catch {
    return []
  }
  const removed: string[] = []
  for (const sessionId of orphans) {
    await removeWorkspace(sessionId)
    removed.push(workspaceContainerName(sessionId))
  }
  return removed
}

function reapOrphanCheckouts(liveSessions: Set<number>): string[] {
  return removeMatching(projectsDir(), /^run-(\d+)$/, id => !liveSessions.has(id))
}

function reapOrphanArchives(liveSessions: Set<number>): string[] {
  return removeMatching(join(dataDir(), 'archives'), /^run-(\d+)$/, id => !liveSessions.has(id))
}

function reapOrphanDumpDirs(liveProjects: Set<number>): string[] {
  return removeMatching(join(dataDir(), 'dumps'), /^(\d+)$/, id => !liveProjects.has(id))
}

// A folder merely removed from projects.sharedFolders keeps its data on purpose.
function reapOrphanSharedDirs(liveProjects: Set<number>): string[] {
  return removeMatching(join(dataDir(), 'shared'), /^(\d+)$/, id => !liveProjects.has(id))
}

function reapOrphanMemoryDirs(liveProjects: Set<number>): string[] {
  return removeMatching(join(dataDir(), 'memory'), /^(\d+)$/, id => !liveProjects.has(id))
}

function reapStaleDumpFiles(projects: { id: number, dbDumpPath: string | null }[]): string[] {
  const removed: string[] = []
  for (const project of projects) {
    const dir = join(dataDir(), 'dumps', String(project.id))
    if (!existsSync(dir)) continue
    const keep = project.dbDumpPath ? basename(project.dbDumpPath) : null
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === keep) continue
      rmSync(join(dir, entry.name), { force: true })
      removed.push(join(String(project.id), entry.name))
    }
  }
  return removed
}

function removeMatching(dir: string, pattern: RegExp, isOrphan: (id: number) => boolean): string[] {
  if (!existsSync(dir)) return []
  const removed: string[] = []
  for (const name of readdirSync(dir)) {
    const id = Number(name.match(pattern)?.[1])
    if (!id || !isOrphan(id)) continue
    rmSync(join(dir, name), { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}

// A volume still copied into a booting session refuses removal and is retried on the next run.
async function reapOrphanDbBases(projects: { dbBase: DbBase | null }[]): Promise<string[]> {
  const keep = new Set(projects.flatMap(p => p.dbBase?.state === 'ready' ? [p.dbBase.volume] : []))
  let volumes: string[]
  try {
    const { stdout } = await execa('docker', ['volume', 'ls', '-q', '--filter', `name=${DB_BASE_PREFIX}`])
    volumes = stdout.split('\n').map(v => v.trim()).filter(Boolean)
  }
  catch {
    return []
  }
  const removed: string[] = []
  for (const volume of volumes) {
    if (keep.has(volume) || dbBaseBuilding(volume)) continue
    try {
      await execa('docker', ['volume', 'rm', volume])
      removed.push(volume)
    }
    catch {
      // In use.
    }
  }
  return removed
}

export interface ImageKeep {
  ddevTag: string | null
  sessions: Set<number>
  building: (tag: string) => boolean
}

// ddev tags one image pair per project name and never removes it, and a ddev upgrade leaves the old version's set behind.
export function staleImages(images: string[], keep: ImageKeep): string[] {
  return images.filter((image) => {
    const [repo = '', tag = ''] = image.split(':')
    if (!repo.startsWith('ddev/') && repo !== 'knecht-workspace') return false
    const session = /-knecht-run-(\d+)-built$/.exec(tag)
    if (session) return !keep.sessions.has(Number(session[1]))
    if (/-knecht-base-.+-built$/.test(tag)) return !keep.building(tag)
    if (!keep.ddevTag || !/^v\d/.test(tag)) return false
    return tag !== keep.ddevTag && !tag.startsWith(`${keep.ddevTag}-`)
  })
}

async function reapStaleImages(): Promise<string[]> {
  let images: string[]
  try {
    const { stdout } = await execa('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}'])
    images = stdout.split('\n').map(i => i.trim()).filter(Boolean)
  }
  catch {
    return []
  }
  // A stopped session boots from its image again; a restore builds one before the session is 'up'.
  const sessions = new Set([
    ...[...listSessionsInEnvState('up'), ...listSessionsInEnvState('stopped')].map(s => s.id),
    ...listSessionIds().filter(id => envTransition(id) !== null),
  ])
  const ddevTag = await ddevWebImage().then(image => image.split(':').at(-1) ?? null, () => null)
  const removed: string[] = []
  for (const image of staleImages(images, { ddevTag, sessions, building: dbBaseBuilding })) {
    try {
      await execa('docker', ['rmi', image])
      removed.push(image)
    }
    catch {
      // In use.
    }
  }
  return removed
}

// Dangling-only, so tagged images (knecht-sandbox, the pinned release image) survive.
async function pruneHostDocker(): Promise<string[]> {
  const pruned: string[] = []
  const targets: [string, string[]][] = [
    ['dangling images', ['image', 'prune', '-f']],
    ['build cache', ['builder', 'prune', '-f']],
  ]
  for (const [label, args] of targets) {
    try {
      const { stdout } = await execa('docker', args)
      const size = stdout.match(/Total[^:]*:\s*([\d.]+\s*[A-Za-z]+)/)?.[1]
      if (size && !/^0\s*B/.test(size)) pruned.push(`${label}: ${size}`)
    }
    catch {
      // docker unreachable.
    }
  }
  return pruned
}
