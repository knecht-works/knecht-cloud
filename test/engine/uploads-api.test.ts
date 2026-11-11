import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { makeProject } from '../helpers/db'

let freeBytes = Number.MAX_SAFE_INTEGER
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, statfs: async (path: string) => ({ ...await fs.statfs(path), bavail: Math.floor(freeBytes / 4096), bsize: 4096 }) }
})
vi.mock('../../server/daemon/envs', () => ({ rebootEnv: async () => {} }))

const { requireProject, updateProjectConfig } = await import('../../server/stores/projects')
const { projectSharedDir } = await import('../../server/utils/storage')
const dumpHandler = (await import('../../server/api/projects/[id]/dump.post')).default
const sharedHandler = (await import('../../server/api/projects/[id]/shared.post')).default

function upload(handler: typeof dumpHandler, path: string, body: string | Uint8Array) {
  return callRoute(handler, { route: '/projects/:id/x', path, body, headers: { 'content-type': 'application/octet-stream' } })
}

describe('POST /api/projects/:id/dump', () => {
  it('streams the raw body to the dump folder and records it on the project', async () => {
    const project = makeProject()
    const res = await upload(dumpHandler, `/projects/${project.id}/x?name=my%20db.sql`, 'CREATE TABLE t (id int);')
    expect(res.status).toBe(200)
    const path = requireProject(project.id).dbDumpPath!
    expect(path.endsWith('my_db.sql')).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('CREATE TABLE t (id int);')
    expect(readdirSync(join(path, '..'))).toEqual(['my_db.sql'])
  })

  it('requires a file name', async () => {
    const project = makeProject()
    expect((await upload(dumpHandler, `/projects/${project.id}/x`, 'x')).status).toBe(400)
  })

  it('refuses a dump larger than the free disk space before writing anything', async () => {
    const project = makeProject()
    freeBytes = 10
    try {
      const res = await upload(dumpHandler, `/projects/${project.id}/x?name=big.sql`, 'x'.repeat(100))
      expect(res.status).toBe(507)
      expect(requireProject(project.id).dbDumpPath).toBeNull()
    }
    finally {
      freeBytes = Number.MAX_SAFE_INTEGER
    }
  })
})

describe('POST /api/projects/:id/shared', () => {
  it('unpacks a streamed zip into the shared folder and cleans up the upload', async () => {
    const project = makeProject()
    updateProjectConfig(project.id, { sharedFolders: ['web/uploads'] })
    const zip = new AdmZip()
    zip.addFile('uploads/a.txt', Buffer.from('hello'))
    const res = await upload(sharedHandler, `/projects/${project.id}/x?path=web/uploads`, zip.toBuffer())
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ folder: 'web/uploads', files: 1 })
    expect(readFileSync(join(projectSharedDir(project.id), 'web/uploads/a.txt'), 'utf8')).toBe('hello')
    expect(existsSync(join(projectSharedDir(project.id), 'web/uploads/uploads'))).toBe(false)
  })

  it('rejects a body that is not a zip', async () => {
    const project = makeProject()
    updateProjectConfig(project.id, { sharedFolders: ['web/uploads'] })
    const res = await upload(sharedHandler, `/projects/${project.id}/x?path=web/uploads`, 'nope')
    expect(res.status).toBe(400)
  })
})
