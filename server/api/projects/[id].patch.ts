import { updateProjectConfig, requireProject } from '#server/stores/projects'
import { assertDevServerConfig, projectConfigSchema } from '#server/utils/project-config'
import { refreshFramework } from '#server/utils/framework'
import { gitProvider } from '#server/git'
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

  const branch = result.data.defaultBranch
  const branchChanged = !!branch && branch !== project.defaultBranch
  if (branchChanged) {
    const branches = await gitProvider(project).listBranches(project).catch(() => {
      throw createError({ statusCode: 502, statusMessage: `Could not reach the repository of ${project.fullName}` })
    })
    if (!branches.includes(branch)) {
      throw createError({ statusCode: 400, statusMessage: `Branch ${branch} does not exist in ${project.fullName}` })
    }
  }

  const updated = updateProjectConfig(id, result.data)

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }
  // The framework is read from the default branch.
  if (branchChanged) refreshFramework(updated).catch(() => {})

  return updated
})
