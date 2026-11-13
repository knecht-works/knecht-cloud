import { join } from 'node:path'
import { projectDetectedEnv, resolveEnv } from '../../../../shared/utils/env-spec'
import { setProjectDump, requireProject } from '../../../stores/projects'
import { startDbBaseBuild } from '../../../daemon/db-base'
import { projectDumpDir, sanitizeFilename } from '../../../utils/storage'
import { receiveUpload } from '../../../utils/upload'

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
  await receiveUpload(event, filePath)

  setProjectDump(id, filePath)
  return startDbBaseBuild(id)
})
