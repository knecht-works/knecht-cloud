import { existsSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execa } from 'execa'
import semver from 'semver'
import { listProjects } from '#server/stores/projects'
import type { DbBase } from '#server/db/schema'
import { GC_AUTO_CATEGORIES, type GcCategory } from '#shared/utils/gc'
import { dataDir, PACKAGE_CACHE_VOLUME, projectsDir } from '#server/utils/storage'
import { DDEV_ENV, ddevWebImage, ensurePackageCache, removeEnvStack } from '#server/daemon/sandbox'
import { DB_BASE_PREFIX, dbBaseBuilding } from '#server/daemon/db-base'
import { envTransition } from '#server/daemon/envs'
import { removeWorkspace, WORKSPACE_LABEL, workspaceContainerName } from '#server/daemon/workspace'
import { listSessionIds, listSessionsInEnvState } from '#server/stores/sessions'
import { deleteToolCallsBefore } from '#server/stores/tool-calls'
import { clearModelCatalogCache } from '#server/utils/ai-catalog'
import { ANY_RELEASE_TAG_RE, clearVersionCache, currentVersion } from '#server/utils/version'
import { IMAGE as RELEASE_IMAGE } from '#server/daemon/update'
import { useStorage } from 'nitropack/runtime'

const TOOL_CALL_RETENTION_MS = 90 * 24 * 60 * 60_000
const PACKAGE_CACHE_MAX_AGE_DAYS = 30
// pnpm and bun stores are left alone: both trust their index over the files on disk.
const PACKAGE_CACHE_DIRS = ['npm/_cacache', 'composer', 'yarn']

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
  packageCache: string[]
  dockerPruned: string[]
  appCache: string[]
}

export async function collectGarbage(categories: readonly GcCategory[] = GC_AUTO_CATEGORIES): Promise<GcResult> {
  const liveSessions = new Set(listSessionIds())
  const projects = listProjects()
  const liveProjects = new Set(projects.map(p => p.id))

  const result: GcResult = { sandboxes: [], checkouts: [], archives: [], dumpDirs: [], dumpFiles: [], dbBases: [], sharedDirs: [], memoryDirs: [], images: [], packageCache: [], dockerPruned: [], appCache: [] }
  if (categories.includes('sessions')) {
    result.sandboxes = [...await reapOrphanSandboxes(liveSessions), ...await reapOrphanWorkspaces(liveSessions), ...await reapOrphanSessionVolumes()]
    result.checkouts = reapOrphanCheckouts(liveSessions)
    result.archives = reapOrphanArchives(liveSessions)
  }
  if (categories.includes('projects')) {
    result.dumpDirs = reapOrphanDumpDirs(liveProjects)
    result.dumpFiles = reapStaleDumpFiles(projects)
    result.dbBases = [...await reapStaleBuilders(), ...await reapOrphanDbBases(projects)]
    result.sharedDirs = reapOrphanSharedDirs(liveProjects)
    result.memoryDirs = reapOrphanMemoryDirs(liveProjects)
  }
  if (categories.includes('images')) {
    result.images = await reapStaleImages()
    result.dockerPruned = await pruneHostDocker()
  }
  if (categories.includes('packageCache')) result.packageCache = await reapOldPackageCache()
  if (categories.includes('appCache')) result.appCache = await clearAppCache()
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

// A teardown whose `ddev delete` failed leaves them, and an archived session keeps its database as a file.
export function staleSessionVolumes(volumes: string[], hasStack: (sessionId: number) => boolean): string[] {
  return volumes.flatMap((line) => {
    const [name = '', project = ''] = line.split('\t')
    const sessionId = Number(/^ddev-knecht-run-(\d+)$/.exec(project.trim())?.[1])
    return sessionId && !hasStack(sessionId) ? [name.trim()] : []
  })
}

async function reapOrphanSessionVolumes(): Promise<string[]> {
  let volumes: string[]
  try {
    const { stdout } = await execa('docker', ['volume', 'ls', '--filter', 'label=com.docker.compose.project', '--format', '{{.Name}}\t{{.Label "com.docker.compose.project"}}'])
    volumes = stdout.split('\n').filter(Boolean)
  }
  catch {
    return []
  }
  const withStack = new Set([...listSessionsInEnvState('up'), ...listSessionsInEnvState('stopped')].map(s => s.id))
  const hasStack = (id: number) => withStack.has(id) || envTransition(id) !== null
  const removed: string[] = []
  for (const volume of staleSessionVolumes(volumes, hasStack)) {
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

export function staleBuilders(containers: string[], building: (name: string) => boolean): string[] {
  const builders = containers.flatMap((name) => {
    const builder = new RegExp(`^ddev-(${DB_BASE_PREFIX}.+)-(web|db)$`).exec(name)?.[1]
    return builder ? [builder] : []
  })
  return [...new Set(builders)].filter(builder => !building(builder))
}

// The cleanup after an interrupted build runs once and may fail; this catches what it left.
async function reapStaleBuilders(): Promise<string[]> {
  let containers: string[]
  try {
    const { stdout } = await execa('docker', ['ps', '-a', '--format', '{{.Names}}', '--filter', `name=ddev-${DB_BASE_PREFIX}`])
    containers = stdout.split('\n').map(c => c.trim()).filter(Boolean)
  }
  catch {
    return []
  }
  const removed: string[] = []
  for (const builder of staleBuilders(containers, dbBaseBuilding)) {
    try {
      await execa('ddev', ['delete', '--omit-snapshot', '-y', builder], { env: DDEV_ENV })
      rmSync(join(dataDir(), 'db-bases', builder), { recursive: true, force: true })
      removed.push(builder)
    }
    catch {
      // Retried on the next run.
    }
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
    // The next start builds the session's image for the current version anyway.
    if (session) return !keep.sessions.has(Number(session[1])) || (!!keep.ddevTag && !tag.startsWith(`${keep.ddevTag}-`))
    if (/-knecht-base-.+-built$/.test(tag)) return !keep.building(tag)
    if (!keep.ddevTag || !/^v\d/.test(tag)) return false
    return tag !== keep.ddevTag && !tag.startsWith(`${keep.ddevTag}-`)
  })
}

// Only older ones: an update pulls the new release before it switches to it.
export function staleReleaseImages(images: string[], current: string): string[] {
  if (!ANY_RELEASE_TAG_RE.test(current)) return []
  return images.filter((image) => {
    const [repo, tag = ''] = image.split(/:(?=[^:]+$)/)
    return repo === RELEASE_IMAGE && ANY_RELEASE_TAG_RE.test(tag) && semver.lt(tag, current)
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
  for (const image of [...staleImages(images, { ddevTag, sessions, building: dbBaseBuilding }), ...staleReleaseImages(images, currentVersion())]) {
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

async function reapOldPackageCache(): Promise<string[]> {
  try {
    const dirs = PACKAGE_CACHE_DIRS.map(dir => `/cache/${dir}`).join(' ')
    await ensurePackageCache()
    const { stdout } = await execa('docker', [
      'run', '--rm', '--user', '0:0', '--entrypoint', 'sh',
      '-v', `${PACKAGE_CACHE_VOLUME}:/cache`,
      await ddevWebImage(),
      '-c', `find ${dirs} -type f -atime +${PACKAGE_CACHE_MAX_AGE_DAYS} -print -delete 2>/dev/null | wc -l`,
    ])
    const files = Number(stdout.trim())
    return files > 0 ? [`${files} files unused for ${PACKAGE_CACHE_MAX_AGE_DAYS} days`] : []
  }
  catch {
    return []
  }
}

async function clearAppCache(): Promise<string[]> {
  await useStorage('cache').clear()
  clearModelCatalogCache()
  clearVersionCache()
  return ['Nitro cache', 'model catalog', 'release check']
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
