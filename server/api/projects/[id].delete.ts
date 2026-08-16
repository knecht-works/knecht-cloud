import { rmSync } from 'node:fs'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { teardownSession } from '../../daemon/envs'
import { sessionArchiveDir } from '../../utils/storage'

// DELETE /api/projects/:id → disconnect a project and clean up after it:
// every session's isolated ddev env + checkout + archive. Without this the
// envs would linger on disk forever.
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const project = getProject(id)
  if (!project) {
    return { ok: true }
  }

  const sessions = db.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.projectId, id)).all()
  for (const session of sessions) {
    await teardownSession(session.id)
    rmSync(sessionArchiveDir(session.id), { recursive: true, force: true })
  }

  db.delete(schema.projects).where(eq(schema.projects.id, id)).run()
  return { ok: true }
})
