import { bridgeBaseUrl, bridgeToken } from '#server/utils/agent-bridge'
import { devServerOrigin } from '#server/utils/dev-origin'
import { previewOrigin } from '#server/utils/origin'
import { previewLabel } from '#shared/utils/preview-host'
import { describeObject, sessionObjects } from '#server/utils/sessions'

// bridgeEnv goes to the agent process per exec, never into the container env:
// the token authorizes pushes and PRs on the session's repo.

export function sessionEnv(sessionId: number, hosts: string[], devServerPort: number | null = null): Record<string, string> {
  const primary = previewOrigin(sessionId)
  if (!primary) return {}
  // The preview origin needs a dashboard login and may not resolve inside the container.
  const internal = hosts.length || devServerPort === null ? 'http://localhost' : `http://localhost:${devServerPort}`
  const env: Record<string, string> = { KNECHT_PREVIEW_URL: primary, KNECHT_INTERNAL_URL: internal }
  for (const host of hosts.slice(1)) {
    const label = previewLabel(host)
    env[`KNECHT_URL_${label.toUpperCase().replaceAll('-', '_')}`] = previewOrigin(sessionId, label)!
  }
  if (devServerPort !== null) env.KNECHT_DEV_SERVER_URL = hosts.length ? devServerOrigin(sessionId)! : primary
  return env
}

export async function bridgeEnv(sessionId: number): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    KNECHT_BRIDGE_URL: `${bridgeBaseUrl()}/agent-bridge`,
    KNECHT_BRIDGE_TOKEN: bridgeToken(sessionId),
    KNECHT_RUN_ID: String(sessionId),
  }
  const objects = sessionObjects(sessionId)
  if (objects.length) env.KNECHT_OBJECT = objects.map(describeObject).join(' and ')
  return env
}
