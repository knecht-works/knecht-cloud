import { existsSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execa } from 'execa'
import { db, schema } from '../db'
import { dataDir, projectsDir } from '../utils/storage'
import { removeEnvStack } from './sandbox'

export interface GcResult {
  sandboxes: string[]
  checkouts: string[]
  archives: string[]
  dumpDirs: string[]
  dumpFiles: string[]
  sharedDirs: string[]
  memoryDirs: string[]
  dockerPruned: string[]
}

export async function collectGarbage(): Promise<GcResult> {
  const liveSessions = new Set(db.select({ id: schema.sessions.id }).from(schema.sessions).all().map(r => r.id))
  const projects = db.select({ id: schema.projects.id, dbDumpPath: schema.projects.dbDumpPath }).from(schema.projects).all()
  const liveProjects = new Set(projects.map(p => p.id))

  const result: GcResult = { sandboxes: [], checkouts: [], archives: [], dumpDirs: [], dumpFiles: [], sharedDirs: [], memoryDirs: [], dockerPruned: [] }
  result.sandboxes = await reapOrphanSandboxes(liveSessions)
  result.checkouts = reapOrphanCheckouts(liveSessions)
  result.archives = reapOrphanArchives(liveSessions)
  result.dumpDirs = reapOrphanDumpDirs(liveProjects)
  result.dumpFiles = reapStaleDumpFiles(projects)
  result.sharedDirs = reapOrphanSharedDirs(liveProjects)
  result.memoryDirs = reapOrphanMemoryDirs(liveProjects)
  result.dockerPruned = await pruneHostDocker()

  return result
}

// List by both labels so an unrelated container is never touched: run stacks carry
// ddev's site-name, hosts upgraded from Sysbox may still hold knecht.run ones.
async function reapOrphanSandboxes(liveSessions: Set<number>): Promise<string[]> {
  const orphans = new Map<number, string>()
  try {
    for (const filter of ['label=com.ddev.site-name', 'label=knecht.run']) {
      const { stdout } = await execa('docker', ['ps', '-a', '--filter', filter, '--format', '{{.Names}}\t{{.Label "com.ddev.site-name"}}'])
      for (const line of stdout.split('\n')) {
        const [name = '', site = ''] = line.trim().split('\t')
        if (!name) continue
        const sessionId = Number((site || name).match(/^knecht-run-(\d+)$/)?.[1])
        if (!sessionId || liveSessions.has(sessionId)) continue
        orphans.set(sessionId, `knecht-run-${sessionId}`)
      }
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
