import { statSync } from 'node:fs'
import { backfillFrameworks } from '../../utils/framework'
import { withLinks } from '../../stores/project-links'
import { requireProject } from '../../stores/projects'
import { gitProvider } from '../../git'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler(async (event) => {
  const project = requireProject(requireIntParam(event))
  await backfillFrameworks([project])
  const dbDumpSize = project.dbDumpPath ? statSync(project.dbDumpPath, { throwIfNoEntry: false })?.size ?? null : null
  return { ...withLinks([project])[0]!, repoUrl: gitProvider(project).repoUrl(project), dbDumpSize }
})
