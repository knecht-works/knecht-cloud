import { rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { teardownRun } from '../../daemon/envs'
import { cancelRun } from '../../daemon/runner'
import { runArchiveDir } from '../../utils/storage'

// DELETE /api/runs/:id → remove a run and tear down its isolated env, checkout
// and archive. Manual cleanup so per-run leftovers don't pile up on disk.
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = getRun(id)
  if (!run) {
    return { ok: true }
  }

  // A still-executing run must stop before its env goes away: without the
  // abort, the runner races the teardown and can recreate the sandbox for a
  // row that no longer exists (an orphan container nothing ever reaps).
  cancelRun(id)

  await teardownRun(id)
  rmSync(runArchiveDir(id), { recursive: true, force: true })

  db.delete(schema.runs).where(eq(schema.runs.id, id)).run()
  return { ok: true }
})
