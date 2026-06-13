import { desc } from 'drizzle-orm'
import { db, schema } from '../../db'

// GET /api/projects → all connected projects, newest first.
export default defineEventHandler(() => {
  return db
    .select()
    .from(schema.projects)
    .orderBy(desc(schema.projects.createdAt))
    .all()
})
