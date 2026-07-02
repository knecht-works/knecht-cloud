import { hostname } from 'node:os'
import { execa } from 'execa'
import { runSandboxName, runWorktreeDir } from '../utils/storage'

// The sandbox seam (run-isolation.md §8): every run gets its own Sysbox
// container — an unprivileged Docker-in-Docker box that boots the project's
// full ddev stack, router included. This module is the ONLY place that knows a
// sandbox is a Sysbox container; if the substrate ever changes (Kata), it's a
// swap of these functions, not a rewrite.
//
// Topology (run-isolation.md §3): the sandbox joins the `knecht-ingress`
// network; the preview proxy reaches the INNER ddev-router at <sandbox>:80
// over plain HTTP (the router binds 0.0.0.0 — baked into sandbox/Dockerfile).

// Where the run's git worktree is bind-mounted inside the sandbox. The inner
// daemon resolves ddev's bind mounts against the SANDBOX filesystem, so the
// path in here is free-standing (no relation to the host path required).
const SANDBOX_PROJECT_DIR = '/project'

const INGRESS_NETWORK = 'knecht-ingress'

function sandboxImage(): string {
  return process.env.KNECHT_SANDBOX_IMAGE || 'knecht-sandbox'
}

// Boot (or resume) the sandbox for a run and wait until its inner dockerd
// answers — after this, `ddev` commands can be exec'd inside. Idempotent:
// a stopped sandbox is started, a running one is left alone.
export async function bootSandbox(runId: number): Promise<void> {
  await ensureIngressNetwork()
  const name = runSandboxName(runId)

  if (await sandboxExists(name)) {
    await execa('docker', ['start', name])
  }
  else {
    await execa('docker', [
      'run', '-d',
      '--name', name,
      '--runtime', 'sysbox-runc',
      '--network', INGRESS_NETWORK,
      '--label', `knecht.run=${runId}`,
      '-v', `${runWorktreeDir(runId)}:${SANDBOX_PROJECT_DIR}`,
      sandboxImage(),
    ])
  }

  await waitForInnerDocker(name)
}

// Stop a run's sandbox (systemd shuts the whole inner world down cleanly via
// STOPSIGNAL). The container — and with it the inner volumes, images and the
// imported DB — persists, so a reboot is quick.
export async function stopSandbox(runId: number): Promise<void> {
  ipCache.delete(runId)
  await execa('docker', ['stop', runSandboxName(runId)])
}

// Fully remove a run's sandbox. The nested daemon, its containers and volumes
// all live in the sandbox's filesystem, so this reclaims everything at once
// (verified: no orphans — run-isolation.md header note).
export async function removeSandbox(runId: number): Promise<void> {
  ipCache.delete(runId)
  try {
    await execa('docker', ['rm', '-f', runSandboxName(runId)])
  }
  catch {
    // Already gone.
  }
}

// Build the `docker exec` argv that runs a command inside a run's sandbox as
// the non-root ddev user (whose uid matches this process — baked into the
// image, see sandbox/Dockerfile), in the project checkout. HOME and USER must
// be set explicitly: `docker exec -u` derives neither, ddev needs both.
export function sandboxExecArgs(runId: number, command: string[]): string[] {
  return [
    'exec', '-u', 'ddev', '-w', SANDBOX_PROJECT_DIR,
    '-e', 'HOME=/home/ddev', '-e', 'USER=ddev',
    runSandboxName(runId), ...command,
  ]
}

// Resolve the address the preview proxy targets: the sandbox's IP on the
// ingress network (the inner router listens there on :80). Resolved by IP, not
// container name, so it works both when Knecht runs as a container (prod) and
// as a plain host process (dev on the VM). Cached per run; the proxy drops the
// entry on connection errors so a rebooted sandbox re-resolves.
const ipCache = new Map<number, string>()

export async function resolvePreview(runId: number): Promise<string | null> {
  const cached = ipCache.get(runId)
  if (cached) return cached
  try {
    const { stdout } = await execa('docker', [
      'inspect', '-f',
      `{{with index .NetworkSettings.Networks "${INGRESS_NETWORK}"}}{{.IPAddress}}{{end}}`,
      runSandboxName(runId),
    ])
    const ip = stdout.trim()
    if (!ip) return null
    ipCache.set(runId, ip)
    return ip
  }
  catch {
    return null
  }
}

export function forgetPreview(runId: number): void {
  ipCache.delete(runId)
}

async function sandboxExists(name: string): Promise<boolean> {
  try {
    await execa('docker', ['inspect', '--type', 'container', name])
    return true
  }
  catch {
    return false
  }
}

// The inner dockerd needs a few seconds after systemd starts (measured ~2-6s;
// run-isolation.md header note). Poll `docker info` inside until it answers.
async function waitForInnerDocker(name: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await execa('docker', ['exec', name, 'docker', 'info'])
      return
    }
    catch {
      await new Promise(r => setTimeout(r, 1000))
    }
  }
  throw new Error('Sandbox booted but its inner Docker daemon never came up')
}

// Make sure the ingress network exists and — when Knecht itself runs as a
// container — that it is attached, so the proxy can reach sandbox IPs.
// Idempotent, best-effort (on the dev VM Knecht is a plain host process and
// reaches bridge IPs directly).
async function ensureIngressNetwork(): Promise<void> {
  try {
    await execa('docker', ['network', 'create', INGRESS_NETWORK])
  }
  catch {
    // Already exists.
  }
  try {
    await execa('docker', ['network', 'connect', INGRESS_NETWORK, hostname()])
  }
  catch {
    // Already connected, or not running as a container — fine either way.
  }
}
