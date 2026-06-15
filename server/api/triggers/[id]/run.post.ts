import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { fireTrigger } from '../../../utils/triggers'
import { rememberGithubToken } from '../../../utils/credentials'

// POST /api/triggers/:id/run → fire a trigger now. Used to run a manual trigger
// and to test a schedule/github one from the UI. The session token is remembered
// here too, so a freshly created schedule has a credential to run with later.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid trigger id' })
  }

  const { user, secure } = await requireUserSession(event)
  if (!secure?.githubToken) {
    throw createError({ statusCode: 401, statusMessage: 'No GitHub token in session' })
  }
  rememberGithubToken(secure.githubToken, user?.login)

  const row = db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Trigger not found' })
  }

  const runIds = fireTrigger(row)
  return { ok: true, runIds }
})
