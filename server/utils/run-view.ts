import type { DdevEnv, Run, Session } from '../db/schema'
import type { Step } from '../../shared/utils/workflow'
import { runHasEnv } from '../../shared/utils/run'
import { hasPreviewTarget } from './preview-target'
import { getProject } from '../stores/projects'
import { getSessionRow } from '../stores/sessions'

interface SessionEnvRow {
  envState: Session['envState']
  previewHosts: string[]
  previewPort: number | null
  steps: Step[] | null
  projectEnv: DdevEnv | null
  projectDevServer: string | null
  projectPreviewPort: number | null
}

export function withSessionEnv<R extends SessionEnvRow>(row: R): Omit<R, 'projectEnv' | 'projectDevServer' | 'projectPreviewPort'> & { hasPreviewTarget: boolean, hasEnv: boolean } {
  const { projectEnv, projectDevServer, projectPreviewPort, ...rest } = row
  return {
    ...rest,
    hasPreviewTarget: hasPreviewTarget(row, { ddevEnv: projectEnv, devServer: projectDevServer, previewPort: projectPreviewPort }),
    hasEnv: runHasEnv(row.envState, row.steps),
  }
}

export function withRunSessionEnv<R extends Run>(run: R, session?: Session) {
  const s = session ?? getSessionRow(run.sessionId)
  const project = getProject(run.projectId)
  return withSessionEnv({
    ...run,
    envState: s?.envState ?? 'down' as const,
    previewHosts: s?.previewHosts ?? [],
    previewReady: s?.previewReady ?? false,
    previewPort: s?.previewPort ?? null,
    projectEnv: project?.ddevEnv ?? null,
    projectDevServer: project?.devServer ?? null,
    projectPreviewPort: project?.previewPort ?? null,
  })
}
