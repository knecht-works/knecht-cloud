import { createHmac, timingSafeEqual } from 'node:crypto'
import { hostname } from 'node:os'
import { execa } from 'execa'
import { deriveKey } from './crypto'

function bridgeKey(): Buffer {
  return deriveKey('knecht-agent-bridge', 'hmac-token')
}

export function bridgeToken(sessionId: number): string {
  // The `run-` prefix must stay: tokens baked into older checkouts' credential
  // helper config were derived with it.
  return createHmac('sha256', bridgeKey()).update(`run-${sessionId}`).digest('hex')
}

export function verifyBridgeToken(sessionId: number, provided: string): boolean {
  const expected = Buffer.from(bridgeToken(sessionId))
  const given = Buffer.from(provided)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

const INGRESS_NETWORK = 'knecht-ingress'
let cachedBase: string | null | undefined

export async function bridgeBaseUrl(): Promise<string | null> {
  if (cachedBase !== undefined) return cachedBase
  cachedBase = await resolveBase()
  return cachedBase
}

async function resolveBase(): Promise<string | null> {
  const port = process.env.NITRO_PORT || process.env.PORT || '3000'
  try {
    const { stdout } = await execa('docker', [
      'inspect', '-f',
      `{{with index .NetworkSettings.Networks "${INGRESS_NETWORK}"}}{{.IPAddress}}{{end}}`,
      hostname(),
    ])
    if (stdout.trim()) return `http://${stdout.trim()}:${port}`
  }
  catch {
    // Not a container: try the gateway.
  }
  try {
    const { stdout } = await execa('docker', [
      'network', 'inspect', INGRESS_NETWORK, '-f', '{{(index .IPAM.Config 0).Gateway}}',
    ])
    if (stdout.trim()) return `http://${stdout.trim()}:${port}`
  }
  catch {
    // No ingress network yet.
  }
  return null
}
