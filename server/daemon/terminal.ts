import Docker from 'dockerode'
import { resolveContainerUser, serviceContainerName, WEB_PROJECT_DIR } from './sandbox'
import { sessionContainer } from './session-sandbox'
import { reviveEnv } from './envs'

const docker = new Docker({ socketPath: '/var/run/docker.sock' })

export interface RunTerminal {
  stream: NodeJS.ReadWriteStream
  resize: (cols: number, rows: number) => void
  close: () => void
}

export async function openRunTerminal(
  sessionId: number,
  service: string,
  size: { cols: number, rows: number },
): Promise<RunTerminal> {
  // A code session's workspace starts on first use.
  if (service === 'web') await reviveEnv(sessionId)
  const name = service === 'web' ? sessionContainer(sessionId) : serviceContainerName(sessionId, service)
  const container = docker.getContainer(name)
  const identity = service === 'web'
    ? await resolveContainerUser(name).then(u => ({
        User: `${u.uid}:${u.gid}`,
        WorkingDir: WEB_PROJECT_DIR,
        Env: [`HOME=${u.home}`, `USER=${u.user}`],
        Cmd: ['bash', '-l'],
      }))
    : { Cmd: ['bash'] }
  const exec = await container.exec({
    ...identity,
    Tty: true,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
  })
  const stream = await exec.start({ hijack: true, stdin: true, Tty: true })
  await exec.resize({ w: size.cols, h: size.rows }).catch(() => {})
  return {
    stream,
    resize: (cols, rows) => void exec.resize({ w: cols, h: rows }).catch(() => {}),
    close: () => stream.destroy(),
  }
}
