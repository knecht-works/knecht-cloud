import type { DdevEnv, Run, Session } from '../db/schema'
import { schema } from '../db'
import { getProject, getSessionRow } from './entities'
import { hasPreviewTarget } from './preview-target'

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

export function withPreviewTarget<R extends PreviewTargetRow>(row: R): Omit<R, 'projectEnv' | 'projectDevServer' | 'projectPreviewPort'> & { hasPreviewTarget: boolean } {
  const { projectEnv, projectDevServer, projectPreviewPort, ...rest } = row
  return {
    ...rest,
    hasPreviewTarget: hasPreviewTarget(row, { ddevEnv: projectEnv, devServer: projectDevServer, previewPort: projectPreviewPort }),
  }
}

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
