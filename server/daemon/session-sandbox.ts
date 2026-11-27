import type { ActionRuntime } from '#server/workflows/actions/types'
import { getSessionRow } from '#server/stores/sessions'
import { copyIntoContainer, execInContainer, resolveContainerIp, runTag, spawnInContainer, stopTaggedProcesses, streamInContainer, webContainerName, WEB_PROJECT_DIR } from '#server/daemon/sandbox'
import { workspaceContainerName } from '#server/daemon/workspace'
import { releaseWorkspace, reviveEnv, reviveWithoutPreview } from '#server/daemon/envs'

// Read per call: a ddev-start step promotes the session mid-run.
export function sessionContainer(sessionId: number): string {
  return getSessionRow(sessionId)?.tier === 'preview' ? webContainerName(sessionId) : workspaceContainerName(sessionId)
}

// The workspace sits on its own network, every ddev container on the session's.
export function resolveSessionContainerIp(sessionId: number, container = sessionContainer(sessionId)): Promise<string | null> {
  const workspace = workspaceContainerName(sessionId)
  return resolveContainerIp(sessionId, container, container === workspace ? workspace : undefined)
}

export function sessionSandbox(sessionId: number, log: (text: string) => void, signal?: AbortSignal, runId?: number): ActionRuntime['sandbox'] {
  const tag = runId === undefined ? {} : runTag(runId)
  return {
    projectDir: WEB_PROJECT_DIR,
    ensureUp: () => reviveEnv(sessionId, log),
    withoutPreview: async () => {
      const { inWorkspace } = await reviveWithoutPreview(sessionId, log)
      const container = inWorkspace ? workspaceContainerName(sessionId) : sessionContainer(sessionId)
      return {
        stream: (command, opts) => streamInContainer(container, command, log, { ...opts?.env, ...tag }, signal),
        exec: async (command, opts) => String((await execInContainer(container, command, { cancelSignal: signal, input: opts?.input, stripFinalNewline: false }, { ...opts?.env, ...tag })).stdout),
        release: inWorkspace ? () => releaseWorkspace(sessionId) : async () => {},
      }
    },
    stream: (command, opts) => streamInContainer(sessionContainer(sessionId), command, log, { ...opts?.env, ...tag }, signal),
    exec: async (command, opts) => String((await execInContainer(sessionContainer(sessionId), command, { cancelSignal: signal, input: opts?.input, stripFinalNewline: false }, { ...opts?.env, ...tag })).stdout),
    spawn: (command, opts) => spawnInContainer(sessionContainer(sessionId), command, { ...opts?.env, ...tag }),
    copyIn: (hostPath, sandboxPath) => copyIntoContainer(sessionContainer(sessionId), hostPath, sandboxPath),
  }
}

// Both containers: a boot step moves the run from the workspace to the web container mid-run.
export async function stopRunProcesses(sessionId: number, runId: number): Promise<boolean> {
  const stopped = await Promise.all([webContainerName(sessionId), workspaceContainerName(sessionId)].map(c => stopTaggedProcesses(c, runId)))
  return stopped.every(Boolean)
}
