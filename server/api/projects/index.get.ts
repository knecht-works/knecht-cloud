import { desc } from 'drizzle-orm'
import { db, schema } from '../../db'
import { backfillFrameworks } from '../../utils/framework'

// GET /api/projects → all connected projects, newest first. Missing framework
// values are resolved from GitHub on the fly (best-effort) and persisted.
export default defineEventHandler(async (event) => {
  const projects = db
    .select()
    .from(schema.projects)
    .orderBy(desc(schema.projects.createdAt))
    .all()

  await backfillFrameworks(event, projects)
  return projects
})
