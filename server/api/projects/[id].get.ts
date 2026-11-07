import { backfillFrameworks } from '../../utils/framework'
import { withLinks } from '../../stores/project-links'
import { requireProject } from '../../stores/projects'
import { gitProvider } from '../../git'

export default defineEventHandler(async (event) => {
  const project = requireProject(requireIntParam(event))
  await backfillFrameworks([project])
  return { ...withLinks([project])[0]!, repoUrl: gitProvider(project).repoUrl(project) }
})
