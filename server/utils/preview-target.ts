import { projectDetectedEnv } from '../../shared/utils/env-spec'
import type { Project, Session } from '../db/schema'
import { getProject } from './entities'
import { previewOrigin } from './origin'

// Whether a session's environment has something a browser can open: a
// repo with its own ddev config serves its hostnames on the web container's
// :80, a generated environment only serves anything when the project runs a
// dev server on a preview port. Everything that advertises a preview URL
// (the workspace frame, the boot step's `url` output, the comment footer,
// KNECHT_PREVIEW_URL) asks this, because `previewReady` alone only says the
// session booted once, which a headless environment does too.
//
// The session's pinned hosts/port are the truth once it booted; before its
// first boot (and after an expired archive) the project's connect-time
// detection decides, so the workspace shows the frame from the first second
// of a ddev project's first run.
export function hasPreviewTarget(
  session: Pick<Session, 'previewHosts' | 'previewPort' | 'envState'>,
  project: Pick<Project, 'ddevEnv' | 'devServer' | 'previewPort'>,
): boolean {
  if (session.previewHosts.length > 0 || session.previewPort != null) return true
  if (session.envState !== 'down') return false
  // The same gate the boot applies (daemon/ddev.ts): a dev server needs
  // both its command and its port.
  return (project.devServer != null && project.previewPort != null) || projectDetectedEnv(project.ddevEnv).source === 'ddev'
}

// The session's preview URL, or null when it has none to advertise: not
// booted yet (previewReady), no preview target, or no base origin configured
// to build it from. The one answer behind the boot step's `url` output, the
// comment footer and KNECHT_PREVIEW_URL.
export function sessionPreviewUrl(session: Session): string | null {
  if (!session.previewReady) return null
  const project = getProject(session.projectId)
  if (!project || !hasPreviewTarget(session, project)) return null
  return previewOrigin(session.id)
}
