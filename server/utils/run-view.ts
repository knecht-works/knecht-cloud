import type { DdevEnv, Run, Session } from '../db/schema'
import { schema } from '../db'
import { getProject, getSessionRow } from './entities'
import { hasPreviewTarget } from './preview-target'

// The session columns the run endpoints (GET /api/runs and /api/runs/:id)
// flatten into their run rows: the env fields under the same historical names
// withSessionEnv serves, plus the session's object (issue/PR) and status for
// the session grouping in the UI. One shared fragment so the list and detail
// endpoints can never drift. The two project columns only feed
// hasPreviewTarget (withPreviewTarget strips them again).
export const runSessionColumns = {
  envState: schema.sessions.envState,
  previewHosts: schema.sessions.previewHosts,
  previewReady: schema.sessions.previewReady,
  previewPort: schema.sessions.previewPort,
  projectEnv: schema.projects.ddevEnv,
  projectDevServer: schema.projects.devServer,
  projectPreviewPort: schema.projects.previewPort,
  objectKind: schema.sessions.objectKind,
  objectNumber: schema.sessions.objectNumber,
  objectTitle: schema.sessions.objectTitle,
  objectUrl: schema.sessions.objectUrl,
  sessionStatus: schema.sessions.status,
}

interface PreviewTargetRow {
  envState: Session['envState']
  previewHosts: string[]
  previewPort: number | null
  projectEnv: DdevEnv | null
  projectDevServer: string | null
  projectPreviewPort: number | null
}

// Turn a row selected with runSessionColumns into the payload: the project
// columns become the one `hasPreviewTarget` flag the workspace renders its
// preview frame on.
export function withPreviewTarget<R extends PreviewTargetRow>(row: R): Omit<R, 'projectEnv' | 'projectDevServer' | 'projectPreviewPort'> & { hasPreviewTarget: boolean } {
  const { projectEnv, projectDevServer, projectPreviewPort, ...rest } = row
  return {
    ...rest,
    hasPreviewTarget: hasPreviewTarget(row, { ddevEnv: projectEnv, devServer: projectDevServer, previewPort: projectPreviewPort }),
  }
}

// The run payload the dashboard consumes: the run row plus its session's env
// fields, flattened in under their historical names. The UI reads
// envState/previewHosts/previewReady off the run since before sessions
// existed; serving them from the session keeps every page working while the
// dedicated session UI is still to come. `sessionId` is what preview URLs
// are built from.
export function withSessionEnv<R extends Run>(run: R, session?: Session) {
  const s = session ?? getSessionRow(run.sessionId)
  const project = getProject(run.projectId)
  const env = {
    envState: s?.envState ?? 'down' as const,
    previewHosts: s?.previewHosts ?? [],
    previewPort: s?.previewPort ?? null,
  }
  return {
    ...run,
    ...env,
    previewReady: s?.previewReady ?? false,
    hasPreviewTarget: project ? hasPreviewTarget(env, project) : false,
  }
}
