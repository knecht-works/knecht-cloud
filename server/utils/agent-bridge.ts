import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { hostname } from 'node:os'
import { execa } from 'execa'

// The agent git bridge: how the agent INSIDE a run's sandbox performs git
// actions (commit, push, open a PR) without any repo credential ever entering
// the sandbox. The sandbox gets two env vars (KNECHT_BRIDGE_URL + a per-run
// token); the `knecht-git` CLI baked into the sandbox image (sandbox/knecht-git)
// POSTs to /agent-bridge, which executes the op host-side against that run's
// worktree only (server/routes/agent-bridge.post.ts). The blast radius of a
// prompt-injected agent stays "this run's branch": the token is scoped to one
// run and the route enforces what each op may touch.

// Per-run bearer token, derived (not stored): HMAC over the run id with a key
// stretched from NUXT_SESSION_PASSWORD (same secret crypto.ts derives from,
// different HKDF info so the keys are independent). Verification recomputes.
function bridgeKey(): Buffer {
  const password = process.env.NUXT_SESSION_PASSWORD
  if (!password || password.length < 32) {
    throw new Error('NUXT_SESSION_PASSWORD must be set (≥ 32 chars) to derive the agent bridge key')
  }
  return Buffer.from(hkdfSync('sha256', password, 'knecht-agent-bridge', 'hmac-token', 32))
}

export function bridgeToken(runId: number): string {
  return createHmac('sha256', bridgeKey()).update(`run-${runId}`).digest('hex')
}

export function verifyBridgeToken(runId: number, provided: string): boolean {
  const expected = Buffer.from(bridgeToken(runId))
  const given = Buffer.from(provided)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// The address the sandbox reaches THIS app under. Sandboxes sit on the
// knecht-ingress docker network; so does the app (as a container in prod,
// joined at boot by daemon/sandbox.ts) or the docker host (dev, where Knecht
// is a plain host process listening on 0.0.0.0 and reachable via the network
// gateway). Resolved once per boot; a null means the bridge is unavailable
// and the agent simply gets no git tools this run.
const INGRESS_NETWORK = 'knecht-ingress'
let cachedBase: string | null | undefined

export async function bridgeBaseUrl(): Promise<string | null> {
  if (cachedBase !== undefined) return cachedBase
  cachedBase = await resolveBase()
  return cachedBase
}

async function resolveBase(): Promise<string | null> {
  const port = process.env.NITRO_PORT || process.env.PORT || '3000'
  // Containerized: our own IP on the ingress network.
  try {
    const { stdout } = await execa('docker', [
      'inspect', '-f',
      `{{with index .NetworkSettings.Networks "${INGRESS_NETWORK}"}}{{.IPAddress}}{{end}}`,
      hostname(),
    ])
    if (stdout.trim()) return `http://${stdout.trim()}:${port}`
  }
  catch {
    // Not running as a container (dev), fall through to the gateway.
  }
  try {
    const { stdout } = await execa('docker', [
      'network', 'inspect', INGRESS_NETWORK, '-f', '{{(index .IPAM.Config 0).Gateway}}',
    ])
    if (stdout.trim()) return `http://${stdout.trim()}:${port}`
  }
  catch {
    // Network not created yet or docker unavailable.
  }
  return null
}

// The env vars that hand the bridge to the agent process (docker exec -e).
// Empty when the bridge address can't be resolved: the knecht-git CLI then
// reports the tools as unavailable instead of hanging.
export async function bridgeEnv(runId: number): Promise<Record<string, string>> {
  const base = await bridgeBaseUrl()
  if (!base) return {}
  return {
    KNECHT_BRIDGE_URL: `${base}/agent-bridge`,
    KNECHT_BRIDGE_TOKEN: bridgeToken(runId),
    KNECHT_RUN_ID: String(runId),
  }
}
