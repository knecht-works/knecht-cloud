import { createHmac, timingSafeEqual } from 'node:crypto'
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

// Set up per session by attachBridgeHost in sandbox.ts.
export const BRIDGE_HOST = 'knecht-bridge'

export function bridgeBaseUrl(): string {
  return `http://${BRIDGE_HOST}:${process.env.NITRO_PORT || process.env.PORT || '3000'}`
}

export async function writeBridgeCredentialHelper(dir: string, sessionId: number): Promise<void> {
  const env = `KNECHT_BRIDGE_URL=${bridgeBaseUrl()}/agent-bridge KNECHT_BRIDGE_TOKEN=${bridgeToken(sessionId)} KNECHT_RUN_ID=${sessionId}`
  await execa('git', ['-C', dir, 'config', 'credential.helper', `!${env} knecht-git credential`])
}
