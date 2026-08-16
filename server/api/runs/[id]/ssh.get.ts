import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { listRunServices, resolveContainerUser, serviceContainerName, WEB_PROJECT_DIR } from '../../../daemon/sandbox'
import { getSettings } from '../../../utils/settings'
import { requireSession } from '../../../utils/entities'
import { defaultSshTarget, sshTerminalCommand } from '../../../utils/ssh'

// GET /api/runs/:id/ssh → what the terminal modal needs, fetched on click
// (not polled: it does one-shot docker calls). `services` feeds the web
// terminal's picker (works without any setting); the per-service ssh commands
// additionally need an ssh target (the setting, or its derived default) and
// come back null without one.
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)
  if (session.envState === 'down' || session.envState === 'archived') {
    throw createError({ statusCode: 409, statusMessage: 'The environment is not available' })
  }

  const sshTarget = getSettings().sshTarget ?? defaultSshTarget()
  const services = session.envState === 'up' ? await listRunServices(session.id) : []

  let sshCommands: Record<string, string> | null = null
  if (sshTarget && services.length) {
    const user = await resolveContainerUser(session.id)
    sshCommands = Object.fromEntries(services.map(service => [
      service,
      service === 'web'
        ? sshTerminalCommand({ sshTarget, containerName: serviceContainerName(session.id, service), workdir: WEB_PROJECT_DIR, user })
        : sshTerminalCommand({ sshTarget, containerName: serviceContainerName(session.id, service) }),
    ]))
  }

  // The operator is about to work in this env: keep the idle-stopper away.
  db.update(schema.sessions).set({ previewLastSeen: new Date() }).where(eq(schema.sessions.id, session.id)).run()

  return { services, sshCommands }
})
