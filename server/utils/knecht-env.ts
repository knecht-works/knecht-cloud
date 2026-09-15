import { getSessionRow } from './entities'
import { bridgeBaseUrl, bridgeToken } from './agent-bridge'
import { devServerOrigin } from './dev-origin'
import { previewOrigin } from './origin'
import { previewLabel } from '../../shared/utils/preview-host'
import { describeObject, sessionObject } from './sessions'

// bridgeEnv goes to the agent process per exec, never into the container env:
// the token authorizes pushes and PRs on the session's repo.

export function sessionEnv(sessionId: number, hosts: string[], devServer = false): Record<string, string> {
  const primary = previewOrigin(sessionId)
  if (!primary) return {}
  const env: Record<string, string> = { KNECHT_PREVIEW_URL: primary }
  for (const host of hosts.slice(1)) {
    const label = previewLabel(host)
    env[`KNECHT_URL_${label.toUpperCase().replaceAll('-', '_')}`] = previewOrigin(sessionId, label)!
  }
  if (devServer) env.KNECHT_DEV_SERVER_URL = hosts.length ? devServerOrigin(sessionId)! : primary
  return env
}

export async function bridgeEnv(sessionId: number): Promise<Record<string, string>> {
  const base = await bridgeBaseUrl()
  if (!base) return {}
  const env: Record<string, string> = {
    KNECHT_BRIDGE_URL: `${base}/agent-bridge`,
    KNECHT_BRIDGE_TOKEN: bridgeToken(sessionId),
    KNECHT_RUN_ID: String(sessionId),
  }
  const session = getSessionRow(sessionId)
  const object = session && sessionObject(session)
  if (object) env.KNECHT_OBJECT = describeObject(object)
  return env
}
