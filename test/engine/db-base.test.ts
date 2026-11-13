import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeProject } from '../helpers/db'

const commands: string[] = []
const failing = new Set<string>()
const missingVolumes = new Set<string>()
const builderMysqlDir: Record<string, string>[] = []
vi.mock('execa', () => ({
  execa: async (file: string, args: string[], options?: { cwd?: string }) => {
    const line = [file, ...args].join(' ')
    commands.push(line)
    if (line === 'ddev start -y' && options?.cwd) {
      const dir = join(options.cwd, '.ddev', 'mysql')
      builderMysqlDir.push(Object.fromEntries(readdirSync(dir).map(name => [name, readFileSync(join(dir, name), 'utf8')])))
    }
    if (failing.has(line) || (args[0] === 'volume' && args[1] === 'inspect' && missingVolumes.has(args[2]!))) {
      throw Object.assign(new Error(`${line} failed`), { stderr: 'boom: the import broke' })
    }
    return { stdout: '' }
  },
}))
const readDir = vi.fn(async (_repo: unknown, _dir: string, _ref?: string): Promise<Record<string, string>> => ({}))
vi.mock('../../server/git', () => ({
  gitProvider: () => ({ readDir }),
}))
vi.mock('../../server/daemon/sandbox', () => ({
  DDEV_ENV: {},
  WEB_PROJECT_DIR: '/var/www/html',
  ddevDefaultDatabase: async () => 'mariadb:11.8',
  ddevWebImage: async () => 'ddev/ddev-webserver:test',
}))

const { archiveDbVolume, cloneDbBase, readyDbBase, restoreDbVolume, startDbBaseBuild } = await import('../../server/daemon/db-base')
const { getProject, setProjectDbBase } = await import('../../server/stores/projects')
const { projectDumpDir } = await import('../../server/utils/storage')

function checkout(config: string): string {
  const dir = join(projectDumpDir(0), '..', `checkout-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(dir, '.ddev'), { recursive: true })
  writeFileSync(join(dir, '.ddev', 'config.yaml'), config)
  return dir
}

function projectWithDump() {
  const project = makeProject({ dbDumpPath: '/elsewhere/db.sql.gz', ddevEnv: { webserver: null, phpVersion: null, dbType: null, dbVersion: null, nodeVersion: null, packageManager: null } })
  writeFileSync(join(projectDumpDir(project.id), 'db.sql.gz'), '')
  return project
}

async function settled(projectId: number) {
  await vi.waitFor(() => expect(getProject(projectId)?.dbBase?.state).not.toBe('building'))
  return getProject(projectId)!.dbBase!
}

beforeEach(() => {
  commands.length = 0
  failing.clear()
  missingVolumes.clear()
})

describe('readyDbBase', () => {
  const ready = { state: 'ready', volume: 'knecht-base-1-x-mariadb', database: 'mariadb:11.8', builtAt: '2026-11-13T00:00:00.000Z' } as const

  it('hands out the base to a session on the same database', async () => {
    const project = makeProject()
    setProjectDbBase(project.id, ready)
    expect(await readyDbBase(project.id, checkout('name: site\n'))).toEqual({ volume: ready.volume, database: 'mariadb:11.8' })
  })

  it('keeps the base from a session that pins another database version', async () => {
    const project = makeProject()
    setProjectDbBase(project.id, ready)
    expect(await readyDbBase(project.id, checkout('name: site\ndatabase:\n  type: mariadb\n  version: "10.11"\n'))).toBeNull()
  })

  it('ignores a base whose volume is gone', async () => {
    const project = makeProject()
    setProjectDbBase(project.id, ready)
    missingVolumes.add(ready.volume)
    expect(await readyDbBase(project.id, checkout('name: site\n'))).toBeNull()
  })
})

describe('cloneDbBase', () => {
  it('replaces the session volume with a copy of the base under ddev\'s own name and label', async () => {
    await cloneDbBase(7, { volume: 'knecht-base-1-x-mariadb', database: 'mariadb:11.8' })
    expect(commands).toEqual([
      'docker volume rm -f knecht-run-7-mariadb',
      'docker volume create --label com.docker.compose.project=ddev-knecht-run-7 knecht-run-7-mariadb',
      'docker run --rm --user 0:0 --entrypoint cp -v knecht-base-1-x-mariadb:/from:ro -v knecht-run-7-mariadb:/to ddev/ddev-webserver:test -a --reflink=auto /from/. /to/',
    ])
  })
})

describe('database volume archive', () => {
  it('packs the session\'s db volume, whichever database it holds', async () => {
    const dir = join(projectDumpDir(0), '..', 'archive-pack')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'db-postgres.tar.gz.partial'), '')
    missingVolumes.add('knecht-run-8-mariadb')
    await archiveDbVolume(8, dir)
    expect(commands.at(-1)).toBe(`docker run --rm --user 0:0 --entrypoint tar -v knecht-run-8-postgres:/from:ro -v ${dir}:/to ddev/ddev-webserver:test -czf /to/db-postgres.tar.gz.partial -C /from .`)
    expect(existsSync(join(dir, 'db-postgres.tar.gz'))).toBe(true)
  })

  it('unpacks an archive into a fresh volume of the same kind', async () => {
    await restoreDbVolume(9, '/archives/run-9/db-mariadb.tar.gz')
    expect(commands).toEqual([
      'docker volume rm -f knecht-run-9-mariadb',
      'docker volume create --label com.docker.compose.project=ddev-knecht-run-9 knecht-run-9-mariadb',
      'docker run --rm --user 0:0 --entrypoint tar -v /archives/run-9:/from:ro -v knecht-run-9-mariadb:/to ddev/ddev-webserver:test -xzf /from/db-mariadb.tar.gz -C /to',
    ])
  })
})

describe('startDbBaseBuild', () => {
  it('imports the dump once, shuts the db down cleanly and keeps its volume as the base', async () => {
    const project = projectWithDump()
    const builder = (startDbBaseBuild(project.id)!.dbBase as { builder: string }).builder
    expect(await settled(project.id)).toMatchObject({ state: 'ready', volume: `${builder}-mariadb`, database: 'mariadb:11.8' })
    const ddev = commands.filter(c => c.startsWith('ddev ') || c.startsWith('docker stop'))
    expect(ddev).toEqual([
      'ddev start -y',
      `ddev import-db --file=${join(projectDumpDir(project.id), 'db.sql.gz')}`,
      `docker stop --time 3600 ddev-${builder}-db`,
      `ddev stop --unlist ${builder}`,
    ])
  })

  it('builds under the repo\'s own MySQL settings from the default branch, with the import tuning last', async () => {
    const project = projectWithDump()
    readDir.mockResolvedValueOnce({ 'case.cnf': '[mysqld]\nlower_case_table_names = 1\n', 'README.md': 'not a config' })
    builderMysqlDir.length = 0
    startDbBaseBuild(project.id)
    await settled(project.id)
    expect(readDir).toHaveBeenLastCalledWith(expect.objectContaining({ id: project.id }), '.ddev/mysql', 'main')
    expect(Object.keys(builderMysqlDir[0]!).sort()).toEqual(['case.cnf', 'zzz-knecht-import.cnf'])
    expect(builderMysqlDir[0]!['case.cnf']).toContain('lower_case_table_names = 1')
  })

  it('records why a build failed and removes what it started', async () => {
    const project = projectWithDump()
    failing.add(`ddev import-db --file=${join(projectDumpDir(project.id), 'db.sql.gz')}`)
    const builder = (startDbBaseBuild(project.id)!.dbBase as { builder: string }).builder
    expect(await settled(project.id)).toEqual({ state: 'failed', error: 'boom: the import broke' })
    expect(commands).toContain(`ddev delete --omit-snapshot -y ${builder}`)
  })

  it('discards a build that a removed dump made obsolete', async () => {
    const project = projectWithDump()
    const builder = (startDbBaseBuild(project.id)!.dbBase as { builder: string }).builder
    setProjectDbBase(project.id, null)
    await vi.waitFor(() => expect(commands).toContain(`docker volume rm -f ${builder}-mariadb`))
    expect(getProject(project.id)!.dbBase).toBeNull()
  })
})
