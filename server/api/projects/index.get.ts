import { listProjects } from '../../stores/projects'
import { backfillFrameworks } from '../../utils/framework'
import { withLinks } from '../../stores/project-links'
import { gitProvider } from '../../git'

export default defineEventHandler(async () => {
  const projects = listProjects()

  await backfillFrameworks(projects)
  return withLinks(projects).map(p => ({ ...p, repoUrl: gitProvider(p).repoUrl(p) }))
})
