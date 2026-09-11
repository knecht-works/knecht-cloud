import { desc } from 'drizzle-orm'
import { db, schema } from '../../db'
import { backfillFrameworks } from '../../utils/framework'

export default defineEventHandler(async () => {
  const projects = db
    .select()
    .from(schema.projects)
    .orderBy(desc(schema.projects.createdAt))
    .all()

  await backfillFrameworks(projects)
  return projects
})
