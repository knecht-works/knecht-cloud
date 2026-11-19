import { statSync } from 'node:fs'
import { backfillFrameworks } from '#server/utils/framework'
import { withLinks } from '#server/stores/project-links'
import { requireProject } from '#server/stores/projects'
import { gitProvider } from '#server/git'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler(async (event) => {
  const project = requireProject(requireIntParam(event))
  await backfillFrameworks([project])
  const dbDumpSize = project.dbDumpPath ? statSync(project.dbDumpPath, { throwIfNoEntry: false })?.size ?? null : null
  return { ...withLinks([project])[0]!, repoUrl: gitProvider(project).repoUrl(project), dbDumpSize }
})
