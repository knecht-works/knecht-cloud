import { listRunServices, resolveContainerUser, serviceContainerName, WEB_PROJECT_DIR } from '../../../daemon/sandbox'
import { sessionContainer } from '../../../daemon/session-sandbox'
import { reviveEnv } from '../../../daemon/envs'
import { getSettings } from '../../../utils/settings'
import { defaultSshTarget, sshTerminalCommand } from '../../../utils/ssh'
import { requireSession, touchSessionPreview } from '../../../stores/sessions'
import { requireRun } from '../../../stores/runs'

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)
  if (session.envState === 'down' || session.envState === 'archived') {
    throw createError({ statusCode: 409, statusMessage: 'The environment is not available' })
  }

  if (session.envState === 'up') await reviveEnv(session.id)
  const sshTarget = getSettings().sshTarget ?? defaultSshTarget()
  const services = session.envState !== 'up' ? [] : session.tier === 'preview' ? await listRunServices(session.id) : ['web']

  let sshCommands: Record<string, string> | null = null
  if (sshTarget && services.length) {
    const web = sessionContainer(session.id)
    const user = await resolveContainerUser(web)
    sshCommands = Object.fromEntries(services.map(service => [
      service,
      service === 'web'
        ? sshTerminalCommand({ sshTarget, containerName: web, workdir: WEB_PROJECT_DIR, user })
        : sshTerminalCommand({ sshTarget, containerName: serviceContainerName(session.id, service) }),
    ]))
  }

  touchSessionPreview(session.id)

  return { services, sshCommands }
})
