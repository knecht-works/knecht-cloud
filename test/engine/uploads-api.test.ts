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

function upload(handler: typeof dumpHandler, path: string, body: string | Uint8Array | ReadableStream, headers: Record<string, string> = {}) {
  return callRoute(handler, { route: '/projects/:id/x', path, body, headers: { 'content-type': 'application/octet-stream', ...headers } })
}

function chunk(handler: typeof dumpHandler, path: string, body: string, offset: number, total: number) {
  return upload(handler, path, body, { 'x-upload-offset': String(offset), 'x-upload-total': String(total) })
}

describe('chunked uploads', () => {
  it('assembles the chunks and finishes only with the last one', async () => {
    const project = makeProject()
    const path = `/projects/${project.id}/x?name=parts.sql`
    expect((await chunk(dumpHandler, path, 'CREATE ', 0, 15)).status).toBe(204)
    expect(requireProject(project.id).dbDumpPath).toBeNull()
    expect((await chunk(dumpHandler, path, 'TABLE t', 7, 15)).status).toBe(204)
    expect((await chunk(dumpHandler, path, ';', 14, 15)).status).toBe(200)
    const dump = requireProject(project.id).dbDumpPath!
    expect(readFileSync(dump, 'utf8')).toBe('CREATE TABLE t;')
    expect(readdirSync(join(dump, '..'))).toEqual(['parts.sql'])
  })

  it('accepts a chunk again after a failed attempt left part of it behind', async () => {
    const project = makeProject()
    const path = `/projects/${project.id}/x?name=retry.sql`
    await chunk(dumpHandler, path, 'CREATE ', 0, 15)
    await chunk(dumpHandler, path, 'TAB', 7, 15)
    expect((await chunk(dumpHandler, path, 'TABLE t', 7, 15)).status).toBe(204)
    expect((await chunk(dumpHandler, path, ';', 14, 15)).status).toBe(200)
    expect(readFileSync(requireProject(project.id).dbDumpPath!, 'utf8')).toBe('CREATE TABLE t;')
  })

  it('refuses a chunk that would leave a gap', async () => {
    const project = makeProject()
    const path = `/projects/${project.id}/x?name=gap.sql`
    await chunk(dumpHandler, path, 'CREATE ', 0, 15)
    expect((await chunk(dumpHandler, path, ';', 14, 15)).status).toBe(409)
  })

  it('refuses a chunk that reaches past the declared total', async () => {
    const project = makeProject()
    expect((await chunk(dumpHandler, `/projects/${project.id}/x?name=over.sql`, 'CREATE TABLE', 0, 5)).status).toBe(400)
  })

  it('unpacks a shared zip once its last chunk arrives', async () => {
    const project = makeProject()
    updateProjectConfig(project.id, { sharedFolders: ['web/uploads'] })
    const zip = new AdmZip()
    zip.addFile('a.txt', Buffer.from('hello'))
    const bytes = zip.toBuffer()
    const path = `/projects/${project.id}/x?path=web/uploads`
    const half = Math.floor(bytes.length / 2)
    expect((await upload(sharedHandler, path, bytes.subarray(0, half), { 'x-upload-offset': '0', 'x-upload-total': String(bytes.length) })).status).toBe(204)
    const res = await upload(sharedHandler, path, bytes.subarray(half), { 'x-upload-offset': String(half), 'x-upload-total': String(bytes.length) })
    expect(res.json).toEqual({ folder: 'web/uploads', files: 1 })
    expect(readFileSync(join(projectSharedDir(project.id), 'web/uploads/a.txt'), 'utf8')).toBe('hello')
  })
})

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

  it('refuses a chunked body that announces no size', async () => {
    const project = makeProject()
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('CREATE TABLE t (id int);'))
        controller.close()
      },
    })
    const res = await upload(dumpHandler, `/projects/${project.id}/x?name=chunked.sql`, body)
    expect(res.status).toBe(411)
    expect(requireProject(project.id).dbDumpPath).toBeNull()
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
