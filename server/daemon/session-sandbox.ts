import type { ActionRuntime } from '../workflows/actions/types'
import { getSessionRow } from '../stores/sessions'
import { copyIntoContainer, execInContainer, resolveContainerIp, spawnInContainer, streamInContainer, webContainerName, WEB_PROJECT_DIR } from './sandbox'
import { workspaceContainerName } from './workspace'
import { reviveEnv } from './envs'

// Read per call: a ddev-start step promotes the session mid-run.
export function sessionContainer(sessionId: number): string {
  return getSessionRow(sessionId)?.tier === 'preview' ? webContainerName(sessionId) : workspaceContainerName(sessionId)
}

// The workspace sits on its own network, every ddev container on the session's.
export function resolveSessionContainerIp(sessionId: number, container = sessionContainer(sessionId)): Promise<string | null> {
  const workspace = workspaceContainerName(sessionId)
  return resolveContainerIp(sessionId, container, container === workspace ? workspace : undefined)
}

export function sessionSandbox(sessionId: number, log: (text: string) => void, signal?: AbortSignal): ActionRuntime['sandbox'] {
  return {
    projectDir: WEB_PROJECT_DIR,
    ensureUp: () => reviveEnv(sessionId, log),
    stream: (command, opts) => streamInContainer(sessionContainer(sessionId), command, log, opts?.env, signal),
    exec: async (command, opts) => String((await execInContainer(sessionContainer(sessionId), command, { cancelSignal: signal }, opts?.env)).stdout),
    spawn: (command, opts) => spawnInContainer(sessionContainer(sessionId), command, opts?.env),
    copyIn: (hostPath, sandboxPath) => copyIntoContainer(sessionContainer(sessionId), hostPath, sandboxPath),
  }
}
