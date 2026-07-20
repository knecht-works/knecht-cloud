import { existsSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execa } from 'execa'
import { db, schema } from '../db'
import { dataDir, projectsDir } from '../utils/storage'
import { removeEnvStack } from './sandbox'

// The reconcile GC (companion to the retention reaper in envs.ts). The reaper
// walks LIVE runs down their lifecycle ladder; this instead reclaims LEFTOVERS
// whose owning DB row is already gone: sandboxes, worktrees, archives and base
// clones a crash or a half-done delete left behind, plus stale DB dumps and
// host-side docker leftovers (dangling images, build cache). It is
// safe to run any time because it only ever touches state the database no
// longer references, so an in-flight run (whose row is present the whole time)
// is never affected. Runs on a timer (server/plugins/gc.ts) and on demand from
// the settings page (POST /api/gc).

export interface GcResult {
  sandboxes: string[] // orphaned run sandbox containers removed
  worktrees: string[] // orphaned run worktree dirs removed
  archives: string[] // orphaned run archive dirs removed
  baseClones: string[] // base clones of deleted projects removed
  dumpDirs: string[] // dump folders of deleted projects removed
  dumpFiles: string[] // superseded DB dumps of live projects removed
  dockerPruned: string[] // host-side docker leftovers pruned (with reclaimed size)
}

// Sweep every category, tolerating a failure in one so the rest still run. Each
// helper reports what it removed; the caller sums for the UI/logs.
export async function collectGarbage(): Promise<GcResult> {
  const liveRuns = new Set(db.select({ id: schema.runs.id }).from(schema.runs).all().map(r => r.id))
  const projects = db.select({ id: schema.projects.id, dbDumpPath: schema.projects.dbDumpPath }).from(schema.projects).all()
  const liveProjects = new Set(projects.map(p => p.id))

  const result: GcResult = { sandboxes: [], worktrees: [], archives: [], baseClones: [], dumpDirs: [], dumpFiles: [], dockerPruned: [] }
  result.sandboxes = await reapOrphanSandboxes(liveRuns)
  result.worktrees = reapOrphanWorktrees(liveRuns)
  result.archives = reapOrphanArchives(liveRuns)
  result.baseClones = reapOrphanBaseClones(liveProjects)
  result.dumpDirs = reapOrphanDumpDirs(liveProjects)
  result.dumpFiles = reapStaleDumpFiles(projects)
  result.dockerPruned = await pruneHostDocker()

  // Removing worktree dirs by rmSync leaves a stale admin entry in each base
  // clone's .git/worktrees; prune them so `git worktree` stays consistent.
  if (result.worktrees.length) pruneWorktrees()

  return result
}

// A run's env containers carry ddev's site-name label with the per-run
// project name knecht-run-<id> (legacy Sysbox sandboxes carried knecht.run
// instead). List by both labels (so we never touch an unrelated container),
// dedupe to run ids, and tear down any whose run row is gone.
async function reapOrphanSandboxes(liveRuns: Set<number>): Promise<string[]> {
  const orphans = new Map<number, string>()
  try {
    for (const filter of ['label=com.ddev.site-name', 'label=knecht.run']) {
      const { stdout } = await execa('docker', ['ps', '-a', '--filter', filter, '--format', '{{.Names}}\t{{.Label "com.ddev.site-name"}}'])
      for (const line of stdout.split('\n')) {
        const [name = '', site = ''] = line.trim().split('\t')
        if (!name) continue
        const runId = Number((site || name).match(/^knecht-run-(\d+)$/)?.[1])
        if (!runId || liveRuns.has(runId)) continue
        orphans.set(runId, `knecht-run-${runId}`)
      }
    }
  }
  catch {
    return [] // docker unreachable: try again next tick
  }
  const removed: string[] = []
  for (const [runId, name] of orphans) {
    await removeEnvStack(runId)
    removed.push(name)
  }
  return removed
}

// Run worktrees are projectsDir()/run-<id>.
function reapOrphanWorktrees(liveRuns: Set<number>): string[] {
  return removeMatching(projectsDir(), /^run-(\d+)$/, id => !liveRuns.has(id))
}

// Base clones are projectsDir()/<id>-<slug>; a deleted project's is a leftover.
function reapOrphanBaseClones(liveProjects: Set<number>): string[] {
  return removeMatching(projectsDir(), /^(\d+)-/, id => !liveProjects.has(id))
}

// Run archives are dataDir()/archives/run-<id>.
function reapOrphanArchives(liveRuns: Set<number>): string[] {
  return removeMatching(join(dataDir(), 'archives'), /^run-(\d+)$/, id => !liveRuns.has(id))
}

// Uploaded dumps live under dataDir()/dumps/<projectId>; a deleted project's
// whole folder is a leftover (project deletion never removed it).
function reapOrphanDumpDirs(liveProjects: Set<number>): string[] {
  return removeMatching(join(dataDir(), 'dumps'), /^(\d+)$/, id => !liveProjects.has(id))
}

// Within a LIVE project's dump folder, remove every dump that isn't the one it
// currently references: uploading a differently-named dump repoints dbDumpPath
// but leaves the previous file behind.
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

// Remove every direct child of `dir` whose name matches `pattern` and whose
// captured numeric id `isOrphan` deems dead. Returns the removed names.
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

// Host-side Docker leftovers: every sandbox rebuild (provision-host.sh) leaves
// the previous knecht-sandbox build behind as a dangling image (~1GB each),
// and those builds also pile up builder cache. Prune both, dangling-only, so
// tagged images (knecht-sandbox, the pinned release image) are never touched.
// Reports one entry per command that actually reclaimed space, with the size.
async function pruneHostDocker(): Promise<string[]> {
  const pruned: string[] = []
  const targets: [string, string[]][] = [
    ['dangling images', ['image', 'prune', '-f']],
    ['build cache', ['builder', 'prune', '-f']],
  ]
  for (const [label, args] of targets) {
    try {
      const { stdout } = await execa('docker', args)
      // Both commands end with a total line ("Total reclaimed space: 1.2GB" /
      // "Total:  1.2GB"); 0B means the command found nothing to remove.
      const size = stdout.match(/Total[^:]*:\s*([\d.]+\s*[A-Za-z]+)/)?.[1]
      if (size && !/^0\s*B/.test(size)) pruned.push(`${label}: ${size}`)
    }
    catch {
      // docker unreachable: try again next tick
    }
  }
  return pruned
}

// Drop stale worktree admin entries from every base clone after their dirs were
// rm'd. Best-effort: a dir that isn't a git repo just fails and is skipped.
function pruneWorktrees(): void {
  const dir = projectsDir()
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (!/^\d+-/.test(name)) continue
    execa('git', ['-C', join(dir, name), 'worktree', 'prune']).catch(() => {})
  }
}
