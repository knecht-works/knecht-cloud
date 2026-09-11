import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import AdmZip from 'adm-zip'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { rebootEnv } from '../../../daemon/envs'
import { sessionHasActiveWork } from '../../../utils/sessions'
import { WEB_PROJECT_DIR, webMountPresent } from '../../../daemon/sandbox'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const project = requireProject(id)

  const form = await readMultipartFormData(event)
  const file = form?.find(part => part.name === 'file' && part.filename)
  const target = normalizeSharedFolder(form?.find(part => part.name === 'path')?.data.toString() ?? '')
  if (!file?.filename || !target) {
    throw createError({ statusCode: 400, statusMessage: 'Zip file and target folder required' })
  }
  if (!project.sharedFolders.includes(target)) {
    throw createError({ statusCode: 400, statusMessage: 'Folder is not configured as shared' })
  }

  let entries
  try {
    entries = new AdmZip(file.data).getEntries().filter(e => !e.isDirectory)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Not a readable zip file' })
  }

  const files = entries
    .map(e => ({ path: normalizeSharedFolder(e.entryName), data: e.getData() }))
    .filter((e): e is { path: string, data: Buffer } =>
      e.path !== null && !e.path.startsWith('__MACOSX/') && !e.path.endsWith('.DS_Store'))
  const tops = new Set(files.map(f => f.path.split('/')[0]))
  const strip = tops.size === 1 && files.every(f => f.path.includes('/'))

  const dir = join(projectSharedDir(id), target)
  let written = 0
  for (const f of files) {
    const rel = strip ? f.path.split('/').slice(1).join('/') : f.path
    if (!rel) continue
    const dest = join(dir, rel)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, f.data)
    written++
  }

  // The bind mount is declared at boot, so envs that were up before the folder existed lack it.
  // Not while work is executing: recreating the web container would kill it.
  const upSessions = db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.projectId, id), eq(schema.sessions.envState, 'up')))
    .all()
  await Promise.all(upSessions.map(async (session) => {
    if (sessionHasActiveWork(session.id)) return
    if (await webMountPresent(session.id, `${WEB_PROJECT_DIR}/${target}`)) return
    await rebootEnv(session.id).catch(() => {})
  }))

  return { folder: target, files: written }
})
