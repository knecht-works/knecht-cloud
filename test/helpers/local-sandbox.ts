import { mkdirSync, mkdtempSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa, type Options } from 'execa'
import type { Project } from '../../server/db/schema'

// Keyed by runId so a resumed run gets the same dir back, marker files included.
const checkouts = new Map<number, string>()

export async function fakeCheckout(_project: Project, runId: number): Promise<string> {
  const existing = checkouts.get(runId)
  if (existing) return existing
  const dir = mkdtempSync(join(tmpdir(), `knecht-run-${runId}-`))
  mkdirSync(join(dir, '.ddev'), { recursive: true })
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  checkouts.set(runId, dir)
  return dir
}

export function checkoutDirOf(runId: number): string {
  const dir = checkouts.get(runId)
  if (!dir) throw new Error(`no fake checkout for run ${runId}`)
  return dir
}

function mapSandboxPath(runId: number, text: string): string {
  return text.replaceAll(`/tmp/knecht-js-${runId}.mjs`, join(checkoutDirOf(runId), `knecht-js-${runId}.mjs`))
}

export function execInSandbox(runId: number, command: string[], options?: Options, env?: Record<string, string>) {
  const mapped = command.map(part => mapSandboxPath(runId, part))
  const [cmd, ...args] = mapped
  return execa(cmd!, args, { ...options, cwd: checkoutDirOf(runId), env: { ...env } })
}

export async function copyIntoSandbox(runId: number, hostPath: string, sandboxPath: string): Promise<void> {
  await copyFile(hostPath, mapSandboxPath(runId, sandboxPath))
}

const STREAM_TAIL_CHARS = 128 * 1024

export function streamInSandbox(runId: number, command: string[], log: (text: string) => void, env?: Record<string, string>, signal?: AbortSignal): Promise<{ code: number, tail: string }> {
  const sub = execInSandbox(runId, command, { reject: false, buffer: false, cancelSignal: signal }, env)
  const chunks: string[] = []
  let size = 0
  const capture = (d: Buffer) => {
    const text = d.toString()
    log(text)
    chunks.push(text)
    size += text.length
    while (size > STREAM_TAIL_CHARS && chunks.length > 1) {
      size -= chunks.shift()!.length
    }
  }
  sub.stdout?.on('data', capture)
  sub.stderr?.on('data', capture)
  return sub.then(r => ({ code: r.exitCode ?? 1, tail: chunks.join('').slice(-STREAM_TAIL_CHARS) }))
}
