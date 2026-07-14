import { mkdirSync, mkdtempSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa, type Options } from 'execa'
import type { Project } from '../../server/db/schema'

// The fake run substrate for engine tests: commands execute directly on the
// test host with the run's fake checkout as cwd, instead of inside a Sysbox
// container. Everything above this seam (runner, actions, log/row plumbing)
// is the real code. Engine test files wire these in via vi.mock (see
// test/engine/runner.test.ts).

// runId -> the run's fake checkout dir. Keyed like the real per-run worktrees
// so a resumed run (same runId) gets the same dir back, marker files included.
const checkouts = new Map<number, string>()

// Replaces daemon/git prepareRunCheckout: a fresh temp dir with a real git
// repo (the git actions run real git against it) and an empty .ddev/ (the
// runner writes its config override there).
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

// The js action copies its script to /tmp/knecht-js-<runId>.mjs inside the
// sandbox and runs it there. Map that container path into the checkout dir so
// the fake stays self-contained on the host.
function mapSandboxPath(runId: number, text: string): string {
  return text.replaceAll(`/tmp/knecht-js-${runId}.mjs`, join(checkoutDirOf(runId), `knecht-js-${runId}.mjs`))
}

// Replaces daemon/sandbox execInSandbox: same signature, runs on the host in
// the run's checkout. Env vars merge over the host env (the real docker exec
// -e semantics for the variables the action sets).
export function execInSandbox(runId: number, command: string[], options?: Options, env?: Record<string, string>) {
  const mapped = command.map(part => mapSandboxPath(runId, part))
  const [cmd, ...args] = mapped
  return execa(cmd!, args, { ...options, cwd: checkoutDirOf(runId), env: { ...env } })
}

// Replaces daemon/sandbox copyIntoSandbox.
export async function copyIntoSandbox(runId: number, hostPath: string, sandboxPath: string): Promise<void> {
  await copyFile(hostPath, mapSandboxPath(runId, sandboxPath))
}
