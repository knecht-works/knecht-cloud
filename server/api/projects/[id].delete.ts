import { rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { teardownRun } from '../../daemon/envs'
import { projectCheckoutDir } from '../../utils/storage'

// DELETE /api/projects/:id → disconnect a project and clean up after it: every
// run's isolated ddev env + worktree, then the base clone. Without this the
// envs/worktrees would linger on disk forever (run rows cascade-delete via FK).
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
  }

  const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()
  if (!project) {
    return { ok: true }
  }

  const baseDir = projectCheckoutDir(project)
  const runs = db.select({ id: schema.runs.id }).from(schema.runs).where(eq(schema.runs.projectId, id)).all()
  for (const run of runs) {
    await teardownRun(run.id, baseDir)
  }
  rmSync(baseDir, { recursive: true, force: true })

  db.delete(schema.projects).where(eq(schema.projects.id, id)).run()
  return { ok: true }
})
