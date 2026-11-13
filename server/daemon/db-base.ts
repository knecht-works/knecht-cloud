import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execa } from 'execa'
import { stringify } from 'yaml'
import type { DbBase, Project } from '../db/schema'
import { projectDetectedEnv, resolveEnv } from '../../shared/utils/env-spec'
import { finishProjectDbBase, getProject, listBuildingDbBases, setProjectDbBase } from '../stores/projects'
import { dataDir, projectDumpDir, sessionSandboxName } from '../utils/storage'
import { freeHostPorts, readDdevConfig } from './ddev'
import { DDEV_ENV, ddevDefaultDatabase, ddevWebImage } from './sandbox'

export const DB_BASE_PREFIX = 'knecht-base-'

const BUILD_DB_MEM_LIMIT = '3g'

// Only the build runs like this: a crash mid-import just fails the build.
// `loose-` keeps a server that lacks an option from refusing to start.
const IMPORT_TUNING = `[mysqld]
loose-innodb-buffer-pool-size = 2G
loose-innodb-log-file-size = 1G
loose-innodb-flush-log-at-trx-commit = 0
loose-innodb-doublewrite = OFF
loose-skip-log-bin
performance_schema = OFF
`

export interface ReadyDbBase {
  volume: string
  database: string
}

const running = new Set<string>()

export function dbBaseBuilding(volume: string): boolean {
  return [...running].some(builder => volume.includes(builder))
}

function dbVolume(ddevName: string, database: string): string {
  return `${ddevName}-${database.startsWith('postgres:') ? 'postgres' : 'mariadb'}`
}

// Null when a type or version alone is pinned: ddev's default for that type is not worth guessing.
async function databaseKey(type: string | null, version: string | null): Promise<string | null> {
  if (!type && !version) return ddevDefaultDatabase()
  return type && version ? `${type}:${version}` : null
}

async function projectDatabase(project: Project): Promise<string | null> {
  const env = resolveEnv(projectDetectedEnv(project.ddevEnv), project)
  if (!env.hasDb.value) return null
  if (env.source === 'generated') return env.database.value
  return databaseKey(project.ddevEnv?.dbType ?? null, project.ddevEnv?.dbVersion ?? null)
}

export async function sessionDatabase(checkoutDir: string): Promise<string | null> {
  const cfg = readDdevConfig(checkoutDir)
  if (!cfg?.hasDb) return null
  return databaseKey(cfg.dbType, cfg.dbVersion)
}

// ddev refuses to start on a volume of another database type or version.
export async function readyDbBase(projectId: number, checkoutDir: string): Promise<ReadyDbBase | null> {
  const base = getProject(projectId)?.dbBase
  if (base?.state !== 'ready') return null
  if (base.database !== await sessionDatabase(checkoutDir).catch(() => null)) return null
  const exists = await execa('docker', ['volume', 'inspect', base.volume]).then(() => true, () => false)
  return exists ? { volume: base.volume, database: base.database } : null
}

// ddev takes a db volume that already exists as is. The label is the one ddev gives its own.
export async function cloneDbBase(sessionId: number, base: ReadyDbBase): Promise<void> {
  const name = sessionSandboxName(sessionId)
  const volume = dbVolume(name, base.database)
  await execa('docker', ['volume', 'rm', '-f', volume])
  await execa('docker', ['volume', 'create', '--label', `com.docker.compose.project=ddev-${name}`, volume])
  await execa('docker', [
    'run', '--rm', '--user', '0:0', '--entrypoint', 'cp',
    '-v', `${base.volume}:/from:ro`, '-v', `${volume}:/to`,
    await ddevWebImage(), '-a', '--reflink=auto', '/from/.', '/to/',
  ])
}

export function startDbBaseBuild(projectId: number): Project | undefined {
  const prior = getProject(projectId)?.dbBase
  const builder = `${DB_BASE_PREFIX}${projectId}-${Date.now().toString(36)}`
  const project = setProjectDbBase(projectId, { state: 'building', builder })
  if (prior?.state === 'ready') void removeVolumes([prior.volume])
  void buildDbBase(projectId, builder)
  return project
}

export function dropDbBase(projectId: number): void {
  const prior = getProject(projectId)?.dbBase
  setProjectDbBase(projectId, null)
  if (prior?.state === 'ready') void removeVolumes([prior.volume])
}

async function buildDbBase(projectId: number, builder: string): Promise<void> {
  running.add(builder)
  const dir = join(dataDir(), 'db-bases', builder)
  const ddev = (args: string[]) => execa('ddev', args, { cwd: dir, env: DDEV_ENV })
  let result: DbBase
  try {
    const project = getProject(projectId)
    const dump = project?.dbDumpPath && join(projectDumpDir(projectId), basename(project.dbDumpPath))
    const database = project && await projectDatabase(project)
    if (!dump || !database) throw new Error('The project has no dump or no database type to build a base from')
    await writeBuilderConfig(dir, builder, database)
    await ddev(['start', '-y'])
    await ddev(['import-db', `--file=${dump}`])
    // ddev stop gives the db 10s, too short to flush a large buffer pool: every clone would then start in crash recovery.
    await execa('docker', ['stop', '--time', '3600', `ddev-${builder}-db`])
    await ddev(['stop', '--unlist', builder])
    result = { state: 'ready', volume: dbVolume(builder, database), database, builtAt: new Date().toISOString() }
  }
  catch (e) {
    await ddev(['delete', '--omit-snapshot', '-y', builder]).catch(() => {})
    result = { state: 'failed', error: failureLine(e) }
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
    await removeVolumes([`ddev-${builder}-snapshots`])
    running.delete(builder)
  }
  if (!finishProjectDbBase(projectId, builder, result) && result.state === 'ready') await removeVolumes([result.volume])
}

async function writeBuilderConfig(dir: string, builder: string, database: string): Promise<void> {
  const [type, version] = database.split(':')
  const [dbPort, webserverPort, httpsPort, mailpitPort] = await freeHostPorts(4)
  mkdirSync(join(dir, '.ddev'), { recursive: true })
  writeFileSync(join(dir, '.ddev', 'config.yaml'), stringify({
    name: builder,
    type: 'php',
    docroot: '',
    webserver_type: 'generic',
    database: { type, version },
    disable_settings_management: true,
    host_db_port: String(dbPort),
    host_webserver_port: String(webserverPort),
    host_https_port: String(httpsPort),
    host_mailpit_port: String(mailpitPort),
  }))
  writeFileSync(join(dir, '.ddev', 'docker-compose.knecht-build.yaml'), stringify({
    services: { db: { mem_limit: BUILD_DB_MEM_LIMIT } },
  }))
  if (type !== 'postgres') {
    mkdirSync(join(dir, '.ddev', 'mysql'))
    writeFileSync(join(dir, '.ddev', 'mysql', '00-knecht-import.cnf'), IMPORT_TUNING)
  }
}

function failureLine(e: unknown): string {
  const err = e as { stderr?: unknown, message?: string }
  const stderr = typeof err.stderr === 'string' ? err.stderr.trim().split('\n').at(-1) : ''
  return stderr || err.message || String(e)
}

async function removeVolumes(volumes: string[]): Promise<void> {
  await execa('docker', ['volume', 'rm', '-f', ...volumes]).catch(() => {})
}

// A build is never running at startup: its ddev project and volumes are leftovers.
export async function failInterruptedDbBases(): Promise<void> {
  for (const { id, builder } of listBuildingDbBases()) {
    if (running.has(builder)) continue
    await execa('ddev', ['delete', '--omit-snapshot', '-y', builder], { env: DDEV_ENV }).catch(() => {})
    rmSync(join(dataDir(), 'db-bases', builder), { recursive: true, force: true })
    finishProjectDbBase(id, builder, { state: 'failed', error: 'Interrupted by a restart of Knecht' })
  }
}
