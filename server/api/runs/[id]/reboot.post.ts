import { execa } from 'execa'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { runWorktreeDir } from '../../../utils/storage'

// POST /api/runs/:id/reboot → restart a run's idle-stopped environment. The
// worktree and volumes (incl. the imported DB) persist, so `ddev start` brings
// it back without re-running the workflow.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid ID' })
  }

  const run = db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()
  if (!run) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }
  if (run.envState === 'down') {
    throw createError({ statusCode: 409, statusMessage: 'No environment to reboot — re-run the workflow' })
  }

  await execa('ddev', ['start'], { cwd: runWorktreeDir(id) })

  return db
    .update(schema.runs)
    .set({ envState: 'up', previewLastSeen: new Date() })
    .where(eq(schema.runs.id, id))
    .returning()
    .get()
})
