import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import AdmZip from 'adm-zip'

// POST /api/projects/:id/shared → seed one of the project's shared folders
// from an uploaded zip (multipart: `path` = the configured folder, `file` =
// the zip). Extracted into the folder's persistent host dir, which every run
// bind-mounts; existing files with the same name are overwritten, others are
// kept (the folder is live data, not a snapshot).
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

  // Keep zip-internal paths, minus junk and unsafe entries (absolute paths,
  // `..`: normalizeSharedFolder rejects both). When every file sits under one
  // common top-level dir (zipping the folder itself, the usual gesture), strip
  // it so the CONTENT lands in the shared folder, not a nested copy of it.
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

  return { folder: target, files: written }
})
