import { updateProjectConfig, requireProject } from '#server/stores/projects'
import { assertDevServerConfig, projectConfigSchema } from '#server/utils/project-config'
import { defineEventHandler, readBody, createError } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const project = requireProject(id)

  const result = projectConfigSchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid project config' })
  }
  assertDevServerConfig({ ...project, ...result.data })

  const updated = updateProjectConfig(id, result.data)

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  return updated
})
