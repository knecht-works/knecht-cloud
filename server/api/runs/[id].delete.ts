import { rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { teardownRun } from '../../daemon/envs'
import { projectCheckoutDir, runArchiveDir } from '../../utils/storage'

// DELETE /api/runs/:id → remove a run and tear down its isolated env, worktree
// and archive. Manual cleanup so per-run leftovers don't pile up on disk.
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
  rmSync(runArchiveDir(id), { recursive: true, force: true })

  db.delete(schema.runs).where(eq(schema.runs.id, id)).run()
  return { ok: true }
})
