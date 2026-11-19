import { join } from 'node:path'
import { projectDetectedEnv, resolveEnv } from '#shared/utils/env-spec'
import { setProjectDump, requireProject } from '#server/stores/projects'
import { startDbBaseBuild } from '#server/daemon/db-base'
import { projectDumpDir, sanitizeFilename } from '#server/utils/storage'
import { receiveUpload } from '#server/utils/upload'
import { defineEventHandler, createError, getQuery } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const project = requireProject(id)
  if (!resolveEnv(projectDetectedEnv(project.ddevEnv), project).hasDb.value) {
    throw createError({ statusCode: 422, statusMessage: 'This environment has no database container.' })
  }

  const name = getQuery(event).name
  if (typeof name !== 'string' || !name) {
    throw createError({ statusCode: 400, statusMessage: 'No file provided' })
  }

  const filePath = join(projectDumpDir(id), sanitizeFilename(name))
  if (!await receiveUpload(event, filePath)) return null

  setProjectDump(id, filePath)
  return startDbBaseBuild(id)
})
