import type { DdevEnv, Run, Session, SessionObjectRow } from '#server/db/schema'
import type { Step } from '#shared/utils/workflow'
import { runHasEnv } from '#shared/utils/run'
import { hasPreviewTarget } from '#server/utils/preview-target'
import { getProject } from '#server/stores/projects'
import { getSessionRow } from '#server/stores/sessions'
import { listObjectRowsOfSessions } from '#server/stores/session-objects'

interface SessionEnvRow {
  envState: Session['envState']
  tier: Session['tier']
  previewHosts: string[]
  previewPort: number | null
  steps: Step[] | null
  projectEnv: DdevEnv | null
  projectDevServer: string | null
  projectPreviewPort: number | null
}

export function withSessionEnv<R extends SessionEnvRow>(row: R): Omit<R, 'projectEnv' | 'projectDevServer' | 'projectPreviewPort'> & { hasPreviewTarget: boolean, hasEnv: boolean, previewReady: boolean } {
  const { projectEnv, projectDevServer, projectPreviewPort, ...rest } = row
  return {
    ...rest,
    hasPreviewTarget: hasPreviewTarget(row, { ddevEnv: projectEnv, devServer: projectDevServer, previewPort: projectPreviewPort }),
    hasEnv: runHasEnv(row.tier, row.steps),
    previewReady: row.tier === 'preview',
  }
}

export function withRunSessionEnv<R extends Run>(run: R, session?: Session) {
  const s = session ?? getSessionRow(run.sessionId)
  const project = getProject(run.projectId)
  return withSessionEnv({
    ...run,
    envState: s?.envState ?? 'down' as const,
    previewHosts: s?.previewHosts ?? [],
    tier: s?.tier ?? 'code' as const,
    previewPort: s?.previewPort ?? null,
    projectEnv: project?.ddevEnv ?? null,
    projectDevServer: project?.devServer ?? null,
    projectPreviewPort: project?.previewPort ?? null,
  })
}

export interface SessionObjectView {
  integration: SessionObjectRow['integration']
  kind: SessionObjectRow['kind']
  key: string
  title: string | null
  url: string | null
  closed: boolean
}

// Every object of each run's session, primary first: a session is one piece of work, shown with all it touches.
export function withSessionObjects<R extends { sessionId: number }>(rows: R[]): (R & { objects: SessionObjectView[] })[] {
  const bySession = new Map<number, SessionObjectView[]>()
  for (const o of listObjectRowsOfSessions([...new Set(rows.map(r => r.sessionId))])) {
    const view = { integration: o.integration, kind: o.kind, key: o.key, title: o.title, url: o.url, closed: o.status === 'closed' }
    bySession.set(o.sessionId, [...bySession.get(o.sessionId) ?? [], view])
  }
  return rows.map(r => ({ ...r, objects: bySession.get(r.sessionId) ?? [] }))
}
