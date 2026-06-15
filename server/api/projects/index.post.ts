import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'
import type { ProjectMeta } from '../../utils/framework'
import { resolveProjectMeta } from '../../utils/framework'
import { getGithubClient } from '../../utils/github'

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

  // Resolve the framework + version + DDEV environment from the repo at connect
  // time (best-effort; backfilled later if it can't be read now).
  let meta: Partial<ProjectMeta> = {}
  try {
    const octokit = await getGithubClient(event)
    meta = await resolveProjectMeta(octokit, result.data.owner, result.data.name, result.data.defaultBranch)
  }
  catch {
    // No token / unreadable — leave null; the GET handlers will retry.
  }

  return db.insert(schema.projects).values({ ...result.data, ...meta }).returning().get()
})
