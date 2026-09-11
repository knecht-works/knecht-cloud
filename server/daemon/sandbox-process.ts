import type { ResultPromise } from 'execa'

export interface SandboxProcess {
  stdin: NodeJS.WritableStream
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
  exited: Promise<number>
  kill: () => void
}

export function toSandboxProcess(child: ResultPromise<{ stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', buffer: false, reject: false }>): SandboxProcess {
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exited: child.then(r => r.exitCode ?? 1, () => 1),
    kill: () => { child.kill() },
  }
}
