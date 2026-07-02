import { execa } from 'execa'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { bootSandbox, sandboxExecArgs } from '../../../daemon/sandbox'

// POST /api/runs/:id/reboot → restart a run's idle-stopped environment. The
// stopped sandbox keeps its filesystem (worktree mount, inner volumes, the
// imported DB), so booting it and running `ddev start` inside brings it back
// without re-running the workflow.
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

  await bootSandbox(id)
  await execa('docker', sandboxExecArgs(id, ['ddev', 'start']))

  return db
    .update(schema.runs)
    .set({ envState: 'up', previewLastSeen: new Date() })
    .where(eq(schema.runs.id, id))
    .returning()
    .get()
})
