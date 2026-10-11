import { listProjects } from '../../stores/projects'
import { backfillFrameworks } from '../../utils/framework'
import { withLinks } from '../../stores/project-links'

export default defineEventHandler(async () => {
  const projects = listProjects()

  await backfillFrameworks(projects)
  return withLinks(projects)
})
