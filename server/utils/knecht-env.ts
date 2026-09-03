import { getSessionRow } from './entities'
import { bridgeBaseUrl, bridgeToken } from './agent-bridge'
import { previewOrigin } from './origin'
import { previewLabel } from '../../shared/utils/preview-host'

// THE place that defines every KNECHT_* variable a session hands to what
// runs inside it. Two sets, by who may see them:
//
// sessionEnv: the project-facing contract (internals/docs/preview-contract.md
// §3). Written into the container's environment at boot (daemon/ddev.ts), so
// the app, the boot commands, the dev server and every exec into the
// container (the agent included) read the same values, and what `$NAME`
// references in the project's own env values resolve against. Nothing
// secret goes here: this env is visible to everything in the container.
//   KNECHT_PREVIEW_URL   the primary preview origin of the session
//   KNECHT_URL_<LABEL>   one per additional hostname of the repo's ddev
//                        config: the label uppercased, `-` as `_`
//
// bridgeEnv: the agent bridge (utils/agent-bridge.ts), passed per exec to
// the agent process only, never into the container env, because the token
// authorizes pushes and PRs on the session's repo.
//   KNECHT_BRIDGE_URL    where knecht-git and the reply tools POST
//   KNECHT_BRIDGE_TOKEN  the per-session bearer token
//   KNECHT_RUN_ID        the session id (historical name, see agent-bridge.ts)
//   KNECHT_OBJECT        "issue #12" / "pull request #34" when the session
//                        belongs to one: switches on knecht-reply/knecht-label

// Empty without a configured base origin: there is nothing to point at.
export function sessionEnv(sessionId: number, hosts: string[]): Record<string, string> {
  const primary = previewOrigin(sessionId)
  if (!primary) return {}
  const env: Record<string, string> = { KNECHT_PREVIEW_URL: primary }
  for (const host of hosts.slice(1)) {
    const label = previewLabel(host)
    env[`KNECHT_URL_${label.toUpperCase().replaceAll('-', '_')}`] = previewOrigin(sessionId, label)!
  }
  return env
}

// Empty when the bridge address can't be resolved: the knecht-git CLI then
// reports the tools as unavailable instead of hanging.
export async function bridgeEnv(sessionId: number): Promise<Record<string, string>> {
  const base = await bridgeBaseUrl()
  if (!base) return {}
  const env: Record<string, string> = {
    KNECHT_BRIDGE_URL: `${base}/agent-bridge`,
    KNECHT_BRIDGE_TOKEN: bridgeToken(sessionId),
    KNECHT_RUN_ID: String(sessionId),
  }
  // Enforcement of what the reply tools may post on stays host-side in the
  // bridge; the marker only tells the CLIs (and the agent, via AGENTS.md)
  // that there is a thread.
  const session = getSessionRow(sessionId)
  if (session?.objectKind && session.objectNumber) {
    env.KNECHT_OBJECT = `${session.objectKind === 'issue' ? 'issue' : 'pull request'} #${session.objectNumber}`
  }
  return env
}
