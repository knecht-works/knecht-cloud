import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { listRunServices, resolveContainerUser, serviceContainerName, WEB_PROJECT_DIR } from '../../../daemon/sandbox'
import { getSettings } from '../../../utils/settings'
import { requireSession } from '../../../utils/entities'
import { defaultSshTarget, sshTerminalCommand } from '../../../utils/ssh'

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

  db.update(schema.sessions).set({ previewLastSeen: new Date() }).where(eq(schema.sessions.id, session.id)).run()

  return { services, sshCommands }
})
