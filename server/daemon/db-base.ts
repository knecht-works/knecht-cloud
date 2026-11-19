import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { execa } from 'execa'
import { stringify } from 'yaml'
import { openPromise as openZip, type Entry, type ZipFile } from 'yauzl'
import type { DbBase, Project } from '#server/db/schema'
import { projectDetectedEnv, resolveEnv } from '#shared/utils/env-spec'
import { gitProvider } from '#server/git'
import { advanceProjectDbBase, getProject, listBuildingDbBases, setProjectDbBase } from '#server/stores/projects'
import { ddevErrorLine } from '#server/utils/ddev-error'
import { dataDir, projectDumpDir, sessionSandboxName } from '#server/utils/storage'
import { freeHostPorts, readDdevConfig } from '#server/daemon/ddev'
import { DDEV_ENV, ddevDefaultDatabase, ddevWebImage } from '#server/daemon/sandbox'

export const DB_BASE_PREFIX = 'knecht-base-'

const BUILD_DB_MEM_LIMIT = '3g'

// Only the build runs like this: a crash mid-import just fails the build.
// `loose-` keeps a server that lacks an option from refusing to start. Loads after
// the repo's own files: none of these change the data files a session reads.
const IMPORT_TUNING = `[mysqld]
loose-innodb-buffer-pool-size = 1G
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

const PROGRESS_POLL_MS = 3000
// For the formats only ddev can unpack. pv shows nothing without a terminal, but its read position is the same number.
const IMPORT_POSITION = 'pid=$(pgrep -x pv) && echo "$(sed -n "s/^pos:[[:space:]]*//p" /proc/$pid/fdinfo/3) $(stat -Lc %s /proc/$pid/fd/3)"'

const running = new Map<string, Promise<void>>()
const cancels = new Map<string, AbortController>()

export function dbBaseBuilding(volume: string): boolean {
  return [...running.keys()].some(builder => volume.includes(builder))
}

// A boot that imported the dump next to a running build would do the same work twice, on the same disk.
export async function waitForDbBaseBuild(projectId: number, signal?: AbortSignal): Promise<void> {
  const base = getProject(projectId)?.dbBase
  const build = base?.state === 'building' ? running.get(base.builder) : undefined
  if (!build) return
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(new Error('Cancelled'))
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    void build.then(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    })
  })
}

type DbVolumeKind = 'mariadb' | 'postgres'
const DB_VOLUME_KINDS: DbVolumeKind[] = ['mariadb', 'postgres']

function volumeKind(database: string): DbVolumeKind {
  return database.startsWith('postgres:') ? 'postgres' : 'mariadb'
}

function dbVolume(ddevName: string, database: string): string {
  return `${ddevName}-${volumeKind(database)}`
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
async function freshSessionDbVolume(sessionId: number, kind: DbVolumeKind): Promise<string> {
  const name = sessionSandboxName(sessionId)
  const volume = `${name}-${kind}`
  await execa('docker', ['volume', 'rm', '-f', volume])
  await execa('docker', ['volume', 'create', '--label', `com.docker.compose.project=ddev-${name}`, volume])
  return volume
}

async function runAsRoot(entrypoint: string, mounts: string[], args: string[]): Promise<void> {
  await execa('docker', [
    'run', '--rm', '--user', '0:0', '--entrypoint', entrypoint,
    ...mounts.flatMap(m => ['-v', m]),
    await ddevWebImage(), ...args,
  ])
}

export async function cloneDbBase(sessionId: number, base: ReadyDbBase): Promise<void> {
  const volume = await freshSessionDbVolume(sessionId, volumeKind(base.database))
  await runAsRoot('cp', [`${base.volume}:/from:ro`, `${volume}:/to`], ['-a', '--reflink=auto', '/from/.', '/to/'])
}

function dbArchiveName(kind: DbVolumeKind): string {
  return `db-${kind}.tar.gz`
}

export function archivedDbVolume(archiveDir: string): string | null {
  const file = DB_VOLUME_KINDS.map(kind => join(archiveDir, dbArchiveName(kind))).find(existsSync)
  return file ?? null
}

// The stopped volume as files: a restore unpacks it instead of replaying SQL.
export async function archiveDbVolume(sessionId: number, archiveDir: string): Promise<void> {
  for (const kind of DB_VOLUME_KINDS) {
    const volume = `${sessionSandboxName(sessionId)}-${kind}`
    if (!await execa('docker', ['volume', 'inspect', volume]).then(() => true, () => false)) continue
    const file = dbArchiveName(kind)
    // Renamed into place: a half-written archive must not look restorable.
    await runAsRoot('tar', [`${volume}:/from:ro`, `${archiveDir}:/to`], ['-czf', `/to/${file}.partial`, '-C', '/from', '.'])
    renameSync(join(archiveDir, `${file}.partial`), join(archiveDir, file))
    return
  }
}

export async function restoreDbVolume(sessionId: number, archive: string): Promise<void> {
  const kind = DB_VOLUME_KINDS.find(k => basename(archive) === dbArchiveName(k))
  if (!kind) throw new Error(`Not a database volume archive: ${archive}`)
  const volume = await freshSessionDbVolume(sessionId, kind)
  await runAsRoot('tar', [`${dirname(archive)}:/from:ro`, `${volume}:/to`], ['-xzf', `/from/${basename(archive)}`, '-C', '/to'])
}

export function startDbBaseBuild(projectId: number): Project | undefined {
  const prior = getProject(projectId)?.dbBase
  const builder = `${DB_BASE_PREFIX}${projectId}-${Date.now().toString(36)}`
  const project = setProjectDbBase(projectId, { state: 'building', builder, step: 'starting' })
  retire(prior)
  running.set(builder, buildDbBase(projectId, builder))
  return project
}

export function dropDbBase(projectId: number): void {
  const prior = getProject(projectId)?.dbBase
  setProjectDbBase(projectId, null)
  retire(prior)
}

function retire(prior: DbBase | null | undefined): void {
  if (prior?.state === 'ready') void removeVolumes([prior.volume])
  if (prior?.state === 'building') cancels.get(prior.builder)?.abort()
}

// Streamed straight into the import: ddev would first copy the whole dump next to the project.
// Dumps made with --no-autocommit (Craft's backups) load each table in one transaction, and InnoDB holds a
// FULLTEXT table's pending inserts in memory until the commit: gigabytes for a large searchindex.
// The builder already skips the per-commit flush that option saves, so committing per statement costs nothing.
const AUTOCOMMIT_OFF = ['\nSET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;', '\nset autocommit=0;'].map(s => Buffer.from(s))

function autocommitOn(): Transform {
  const keep = Math.max(...AUTOCOMMIT_OFF.map(p => p.length)) - 1
  let carry = Buffer.alloc(0)
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      const buf = Buffer.concat([carry, chunk])
      for (const p of AUTOCOMMIT_OFF) {
        for (let i = buf.indexOf(p); i !== -1; i = buf.indexOf(p, i + p.length)) buf[i + p.length - 2] = 0x31
      }
      carry = buf.subarray(Math.max(0, buf.length - keep))
      done(null, buf.subarray(0, buf.length - carry.length))
    },
    flush(done) {
      done(null, carry)
    },
  })
}

async function dumpStreams(file: string, onPercent: (percent: number) => void): Promise<[Readable, ...Transform[]] | null> {
  const name = file.toLowerCase()
  if (name.endsWith('.zip')) {
    const zip = await openZip(file, { lazyEntries: true })
    const entry = await sqlEntry(zip)
    const stream = await zip.openReadStreamPromise(entry)
    zip.close()
    return [stream, progress(entry.uncompressedSize, onPercent), autocommitOn()]
  }
  const gzipped = name.endsWith('.gz') && !name.endsWith('.tar.gz')
  if (!gzipped && !name.endsWith('.sql') && !name.endsWith('.mysql')) return null
  return [createReadStream(file), progress(statSync(file).size, onPercent), ...(gzipped ? [createGunzip()] : []), autocommitOn()]
}

function progress(total: number, onPercent: (percent: number) => void): Transform {
  let read = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      read += chunk.length
      onPercent(Math.floor(read / total * 100))
      done(null, chunk)
    },
  })
}

function sqlEntry(zip: ZipFile): Promise<Entry> {
  return new Promise((resolve, reject) => {
    zip.on('entry', (entry: Entry) => {
      if (/\.sql$/i.test(entry.fileName) && !entry.fileName.startsWith('__MACOSX/')) resolve(entry)
      else zip.readEntry()
    })
    zip.on('end', () => reject(new Error('The zip file holds no .sql dump.')))
    zip.on('error', reject)
    zip.readEntry()
  })
}

async function importPercent(builder: string): Promise<number | null> {
  const { stdout } = await execa('docker', ['exec', `ddev-${builder}-db`, 'sh', '-c', IMPORT_POSITION], { reject: false })
  const [read, total] = String(stdout ?? '').trim().split(' ').map(Number)
  return read! >= 0 && total! > 0 ? Math.min(100, Math.floor(read! / total! * 100)) : null
}

async function buildDbBase(projectId: number, builder: string): Promise<void> {
  const cancel = new AbortController()
  cancels.set(builder, cancel)
  const dir = join(dataDir(), 'db-bases', builder)
  const ddev = (args: string[]) => execa('ddev', args, { cwd: dir, env: DDEV_ENV, cancelSignal: cancel.signal })
  let importingSince: string | undefined
  let percent: number | undefined
  const report = (step: 'importing' | 'finishing', next = percent) => {
    if (step === 'importing' && importingSince && next === percent) return
    percent = next
    importingSince ??= new Date().toISOString()
    advanceProjectDbBase(projectId, builder, { state: 'building', builder, step, importingSince, percent })
  }
  let result: DbBase
  try {
    const project = getProject(projectId)
    const dump = project?.dbDumpPath && join(projectDumpDir(projectId), basename(project.dbDumpPath))
    const database = project && await projectDatabase(project)
    if (!dump || !database) throw new Error('The project has no dump or no database type to build a base from')
    if (!existsSync(dump)) throw new Error('The dump file is gone from the server. Upload it again.')
    // Settings like lower_case_table_names are fixed into the data files, so the base must be built under the repo's own.
    const repoConfig = database.startsWith('postgres:') ? {} : await gitProvider(project).readDir(project, '.ddev/mysql', project.defaultBranch)
    await writeBuilderConfig(dir, builder, database, repoConfig)
    await ddev(['start', '-y'])
    report('importing')
    const source = await dumpStreams(dump, read => report('importing', read))
    if (source) {
      const importing = ddev(['import-db'])
      // A dump that breaks off mid-stream may still import cleanly, or fail on the cut statement: its own error is the real one.
      // EPIPE only means the import quit first.
      const [fed, imported] = await Promise.allSettled([pipeline([...source, importing.stdin!]), importing])
      if (fed.status === 'rejected' && (fed.reason as NodeJS.ErrnoException).code !== 'EPIPE') throw fed.reason
      if (imported.status === 'rejected') throw imported.reason
    }
    else {
      let polling = true
      const poll = setInterval(() => void importPercent(builder).then((read) => {
        if (polling && read != null) report('importing', read)
      }, () => {}), PROGRESS_POLL_MS)
      try {
        await ddev(['import-db', `--file=${dump}`])
      }
      finally {
        polling = false
        clearInterval(poll)
      }
    }
    report('finishing')
    // ddev stop gives the db 10s, too short to flush a large buffer pool: every clone would then start in crash recovery.
    await execa('docker', ['stop', '--time', '3600', `ddev-${builder}-db`])
    await ddev(['stop', '--unlist', builder])
    result = { state: 'ready', volume: dbVolume(builder, database), database, builtAt: new Date().toISOString() }
  }
  catch (e) {
    await execa('ddev', ['delete', '--omit-snapshot', '-y', builder], { cwd: dir, env: DDEV_ENV }).catch(() => {})
    result = { state: 'failed', error: failureLine(e) }
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
    await removeVolumes([`ddev-${builder}-snapshots`])
    running.delete(builder)
    cancels.delete(builder)
  }
  if (!advanceProjectDbBase(projectId, builder, result) && result.state === 'ready') await removeVolumes([result.volume])
}

async function writeBuilderConfig(dir: string, builder: string, database: string, repoConfig: Record<string, string>): Promise<void> {
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
    for (const [name, text] of Object.entries(repoConfig)) {
      if (name.endsWith('.cnf')) writeFileSync(join(dir, '.ddev', 'mysql', name), text)
    }
    writeFileSync(join(dir, '.ddev', 'mysql', 'zzz-knecht-import.cnf'), IMPORT_TUNING)
  }
}

function failureLine(e: unknown): string {
  const err = e as { stderr?: unknown, message?: string }
  const stderr = typeof err.stderr === 'string' ? ddevErrorLine(err.stderr) : ''
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
    advanceProjectDbBase(id, builder, { state: 'failed', error: 'Interrupted by a restart of Knecht' })
  }
}
