import { requireProject } from '../../../stores/projects'
import { startDbBaseBuild } from '../../../daemon/db-base'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const project = requireProject(id)
  if (!project.dbDumpPath) {
    throw createError({ statusCode: 422, statusMessage: 'This project has no database dump to build from.' })
  }
  if (project.dbBase?.state === 'building') {
    throw createError({ statusCode: 409, statusMessage: 'The base database is already building.' })
  }
  return startDbBaseBuild(id)
})
