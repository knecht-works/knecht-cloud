import { listProjects } from '#server/stores/projects'
import { backfillFrameworks } from '#server/utils/framework'
import { withLinks } from '#server/stores/project-links'
import { gitProvider } from '#server/git'
import { defineEventHandler } from 'h3'

export default defineEventHandler(async () => {
  const projects = listProjects()

  await backfillFrameworks(projects)
  return withLinks(projects).map(p => ({ ...p, repoUrl: gitProvider(p).repoUrl(p) }))
})
