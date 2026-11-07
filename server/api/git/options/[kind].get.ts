import { z } from 'zod'
import { gitProvider } from '../../../git'
import { getProject } from '../../../stores/projects'

const LISTS = {
  branches: 'listBranches',
  labels: 'listLabels',
  assignees: 'listAssignees',
} as const

export default defineEventHandler(async (event) => {
  const list = LISTS[getRouterParam(event, 'kind') as keyof typeof LISTS]
  if (!list) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown option list' })
  }
  const id = z.coerce.number().int().safeParse(getQuery(event).project)
  const project = id.success ? getProject(id.data) : undefined
  if (!project) {
    throw createError({ statusCode: 400, statusMessage: 'Missing project' })
  }
  try {
    return await gitProvider(project)[list](project)
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: `Could not reach the repository of ${project.fullName}` })
  }
})
