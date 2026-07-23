import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { listRunServices, resolveContainerUser, serviceContainerName, WEB_PROJECT_DIR } from '../../../daemon/sandbox'
import { getSettings } from '../../../utils/settings'
import { defaultSshTarget, sshTerminalCommand, vscodeRemoteUrl } from '../../../utils/ssh'
import { runWorktreeDir } from '../../../utils/storage'

// GET /api/runs/:id/ssh → everything the run page's remote-access UI needs,
// fetched on click (not polled: it does one-shot docker calls). `services`
// feeds the web terminal's picker (works without any setting); the ssh
// commands and the VS Code link additionally need the `sshTarget` setting and
// come back null without it. Commands exist only while the stack is up; the
// VS Code link also works on a stopped env (the worktree survives stops).
export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  if (run.envState === 'down' || run.envState === 'archived') {
    throw createError({ statusCode: 409, statusMessage: 'The environment is not available' })
  }

  const sshTarget = getSettings().sshTarget ?? defaultSshTarget()
  const services = run.envState === 'up' ? await listRunServices(id) : []

  let sshCommands: Record<string, string> | null = null
  if (sshTarget && services.length) {
    const user = await resolveContainerUser(id)
    sshCommands = Object.fromEntries(services.map(service => [
      service,
      service === 'web'
        ? sshTerminalCommand({ sshTarget, containerName: serviceContainerName(id, service), workdir: WEB_PROJECT_DIR, user })
        : sshTerminalCommand({ sshTarget, containerName: serviceContainerName(id, service) }),
    ]))
  }

  // The operator is about to work in this env: keep the idle-stopper away.
  db.update(schema.runs).set({ previewLastSeen: new Date() }).where(eq(schema.runs.id, id)).run()

  return {
    services,
    sshCommands,
    vscodeUrl: sshTarget ? vscodeRemoteUrl(sshTarget, runWorktreeDir(id)) : null,
  }
})
