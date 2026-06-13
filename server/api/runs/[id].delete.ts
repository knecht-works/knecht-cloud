import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { teardownRun } from '../../daemon/ddev'
import { projectCheckoutDir } from '../../utils/storage'

// DELETE /api/runs/:id → remove a run and tear down its isolated env + worktree.
// Manual cleanup so isolated-per-run envs don't pile up on disk indefinitely.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
  }

  const run = db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()
  if (!run) {
    return { ok: true }
  }

  const project = db.select().from(schema.projects).where(eq(schema.projects.id, run.projectId)).get()
  if (project) {
    await teardownRun(id, projectCheckoutDir(project))
  }

  db.delete(schema.runs).where(eq(schema.runs.id, id)).run()
  return { ok: true }
})
