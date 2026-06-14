import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'
import { fetchDdevType, fetchFrameworkVersion, getGithubClient } from '../../utils/github'

// POST /api/projects → connect a repo (creates a project). Body comes from a
// repo the user picked out of GET /api/github/repos.
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

  const existing = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.githubId, result.data.githubId))
    .get()
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'Repo is already connected' })
  }

  // Resolve the framework + version from the repo's ddev config and composer.lock
  // at connect time (best-effort; backfilled later if it can't be read now).
  let framework: string | null = null
  let frameworkVersion: string | null = null
  try {
    const octokit = await getGithubClient(event)
    framework = await fetchDdevType(octokit, result.data.owner, result.data.name, result.data.defaultBranch)
    if (framework) {
      frameworkVersion = await fetchFrameworkVersion(octokit, result.data.owner, result.data.name, framework, result.data.defaultBranch)
    }
  }
  catch {
    // No token / unreadable — leave null; the GET handlers will retry.
  }

  return db.insert(schema.projects).values({ ...result.data, framework, frameworkVersion }).returning().get()
})
