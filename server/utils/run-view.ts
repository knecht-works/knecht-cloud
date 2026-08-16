import type { Run, Session } from '../db/schema'
import { getSession } from './entities'

// The run payload the dashboard consumes: the run row plus its session's env
// fields, flattened in under their historical names. The UI reads
// envState/previewHosts/previewReady off the run since before sessions
// existed; serving them from the session keeps every page working while the
// dedicated session UI is still to come. `sessionId` is what preview URLs
// are built from.
export function withSessionEnv<R extends Run>(run: R, session?: Session) {
  const s = session ?? getSession(run.sessionId)
  return {
    ...run,
    envState: s?.envState ?? 'down',
    previewHosts: s?.previewHosts ?? [],
    previewReady: s?.previewReady ?? false,
  }
}
