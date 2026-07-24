import { rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { teardownRun } from '../../daemon/envs'
import { runArchiveDir } from '../../utils/storage'

// DELETE /api/projects/:id → disconnect a project and clean up after it: every
// run's isolated ddev env + checkout + archive. Without this the envs would
// linger on disk forever (run rows cascade-delete via FK).
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const project = getProject(id)
  if (!project) {
    return { ok: true }
  }

  const runs = db.select({ id: schema.runs.id }).from(schema.runs).where(eq(schema.runs.projectId, id)).all()
  for (const run of runs) {
    await teardownRun(run.id)
    rmSync(runArchiveDir(run.id), { recursive: true, force: true })
  }

  db.delete(schema.projects).where(eq(schema.projects.id, id)).run()
  return { ok: true }
})
