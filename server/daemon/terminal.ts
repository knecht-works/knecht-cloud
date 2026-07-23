import Docker from 'dockerode'
import { resolveContainerUser, serviceContainerName, WEB_PROJECT_DIR } from './sandbox'

// An interactive TTY shell inside one of a run's service containers, over the
// docker socket (dockerode exec with a hijacked duplex stream: no sshd, no
// node-pty). The web container gets the same identity every Knecht exec uses
// (this process's uid, HOME/USER from the container passwd, project dir);
// other services (db, extra ddev services) get their default user, like
// `ddev ssh -s <service>`. The transport side lives in api/runs/[id]/terminal.ts.

const docker = new Docker({ socketPath: '/var/run/docker.sock' })

export interface RunTerminal {
  stream: NodeJS.ReadWriteStream
  resize: (cols: number, rows: number) => void
  close: () => void
}

export async function openRunTerminal(
  runId: number,
  service: string,
  size: { cols: number, rows: number },
): Promise<RunTerminal> {
  const container = docker.getContainer(serviceContainerName(runId, service))
  const identity = service === 'web'
    ? await resolveContainerUser(runId).then(u => ({
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
    // Resize failures (a session that just ended) must not surface.
    resize: (cols, rows) => void exec.resize({ w: cols, h: rows }).catch(() => {}),
    // Destroying the hijacked stream hangs up bash; a container stop kills
    // the session anyway.
    close: () => stream.destroy(),
  }
}
