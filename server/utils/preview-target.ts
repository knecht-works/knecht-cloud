import { projectDetectedEnv } from '../../shared/utils/env-spec'
import type { Project, Session } from '../db/schema'
import { getProject } from './entities'
import { previewOrigin } from './origin'

// A repo with its own ddev config serves its site even with an empty pinned host
// list: ddev defaults the name when config.yaml omits it or fails to parse.
export function hasPreviewTarget(
  session: Pick<Session, 'previewHosts' | 'previewPort' | 'envState'>,
  project: Pick<Project, 'ddevEnv' | 'devServer' | 'previewPort'>,
): boolean {
  if (session.previewHosts.length > 0 || session.previewPort != null) return true
  if (projectDetectedEnv(project.ddevEnv).source === 'ddev') return true
  if (session.envState !== 'down') return false
  return project.devServer != null && project.previewPort != null
}

export function sessionPreviewUrl(session: Session): string | null {
  if (!session.previewReady) return null
  const project = getProject(session.projectId)
  if (!project || !hasPreviewTarget(session, project)) return null
  return previewOrigin(session.id)
}
