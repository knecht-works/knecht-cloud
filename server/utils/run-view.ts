import type { Run, Session } from '../db/schema'
import { schema } from '../db'
import { getSessionRow } from './entities'

// The session columns the run endpoints (GET /api/runs and /api/runs/:id)
// flatten into their run rows: the env fields under the same historical names
// withSessionEnv serves, plus the session's object (issue/PR) and status for
// the session grouping in the UI. One shared fragment so the list and detail
// endpoints can never drift.
export const runSessionColumns = {
  envState: schema.sessions.envState,
  previewHosts: schema.sessions.previewHosts,
  previewReady: schema.sessions.previewReady,
  objectKind: schema.sessions.objectKind,
  objectNumber: schema.sessions.objectNumber,
  objectTitle: schema.sessions.objectTitle,
  objectUrl: schema.sessions.objectUrl,
  sessionStatus: schema.sessions.status,
}

// The run payload the dashboard consumes: the run row plus its session's env
// fields, flattened in under their historical names. The UI reads
// envState/previewHosts/previewReady off the run since before sessions
// existed; serving them from the session keeps every page working while the
// dedicated session UI is still to come. `sessionId` is what preview URLs
// are built from.
export function withSessionEnv<R extends Run>(run: R, session?: Session) {
  const s = session ?? getSessionRow(run.sessionId)
  return {
    ...run,
    envState: s?.envState ?? 'down',
    previewHosts: s?.previewHosts ?? [],
    previewReady: s?.previewReady ?? false,
  }
}
