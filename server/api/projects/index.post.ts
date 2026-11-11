import { z } from 'zod'
import { createProject, getProjectByRepo } from '../../stores/projects'
import { REPO_PROVIDERS } from '../../../shared/utils/integrations'
import { frameworkUrlMode } from '../../../shared/utils/frameworks'
import type { ProjectMeta } from '../../utils/framework'
import { gitProvider } from '../../git'
import { assertDevServerConfig, projectConfigSchema } from '../../utils/project-config'

const bodySchema = z.object({
  repoProvider: z.enum(REPO_PROVIDERS),
  repoId: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().min(1),
  defaultBranch: z.string().min(1),
  private: z.boolean(),
}).extend(projectConfigSchema.pick({ envVars: true, bootCommands: true, database: true, devServer: true, previewPort: true }).shape)

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid project data' })
  }
  assertDevServerConfig(result.data)

  if (getProjectByRepo(result.data.repoProvider, result.data.repoId)) {
    throw createError({ statusCode: 409, statusMessage: 'Repo is already connected' })
  }

  let meta: ProjectMeta | undefined
  try {
    meta = await gitProvider(result.data).projectMeta(result.data, result.data.defaultBranch)
  }
  catch {
    // Connect anyway, the backfill retries.
  }

  return createProject({ ...result.data, ...meta, urlMode: frameworkUrlMode(meta?.framework) })
})
