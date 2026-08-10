import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'
import type { ProjectMeta } from '../../utils/framework'
import { resolveProjectMeta } from '../../utils/framework'
import { getInstallationClient } from '../../utils/github-app'

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

  // Resolve the framework + version + DDEV environment from the repo at
  // connect time. A repo we CAN read but that has no `.ddev/config.yaml`
  // (meta null) can never boot: reject right here instead of letting the
  // first run fail. An unreadable repo (App not installed, rate limit) stays
  // best-effort: nulls now, backfilled by the GET handlers later.
  let meta: ProjectMeta | null | undefined
  try {
    const octokit = await getInstallationClient(result.data.owner, result.data.name)
    meta = await resolveProjectMeta(octokit, result.data.owner, result.data.name, result.data.defaultBranch)
  }
  catch {
    // Couldn't look: connect anyway, the backfill retries.
  }
  if (meta === null) {
    throw createError({
      statusCode: 422,
      statusMessage: `The repo has no .ddev/config.yaml on '${result.data.defaultBranch}'. Knecht needs a DDEV config to boot the project.`,
    })
  }

  return db.insert(schema.projects).values({ ...result.data, ...meta }).returning().get()
})
