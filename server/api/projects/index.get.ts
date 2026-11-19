import { listProjects } from '../../stores/projects'
import { backfillFrameworks } from '../../utils/framework'
import { withLinks } from '../../stores/project-links'
import { gitProvider } from '../../git'
import { defineEventHandler } from 'h3'

export default defineEventHandler(async () => {
  const projects = listProjects()

  await backfillFrameworks(projects)
  return withLinks(projects).map(p => ({ ...p, repoUrl: gitProvider(p).repoUrl(p) }))
})
