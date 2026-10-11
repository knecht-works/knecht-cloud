import { z } from 'zod'
import { createProject, getProjectByGithubId } from '../../stores/projects'
import type { ProjectMeta } from '../../utils/framework'
import { resolveProjectMeta } from '../../utils/framework'
import { getInstallationClient } from '../../utils/github-app'

const bodySchema = z.object({
  githubId: z.number().int(),
  owner: z.string().min(1),
  name: z.string().min(1),
  fullName: z.string().min(1),
  defaultBranch: z.string().min(1),
  private: z.boolean(),
  cloneUrl: z.string().url(),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid project data' })
  }

  if (getProjectByGithubId(result.data.githubId)) {
    throw createError({ statusCode: 409, statusMessage: 'Repo is already connected' })
  }

  let meta: ProjectMeta | undefined
  try {
    const octokit = await getInstallationClient(result.data.owner, result.data.name)
    meta = await resolveProjectMeta(octokit, result.data.owner, result.data.name, result.data.defaultBranch)
  }
  catch {
    // Connect anyway, the backfill retries.
  }

  return createProject({ ...result.data, ...meta })
})
