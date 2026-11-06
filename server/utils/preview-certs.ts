import { previewLabel } from '../../shared/utils/preview-host'
import { readDdevHosts } from '../daemon/ddev'
import { devServerLabel } from './dev-origin'
import { previewOrigin } from './origin'
import { sessionCheckoutDir } from './storage'
import { getSessionRow } from '../stores/sessions'

const ISSUE_TIMEOUT_MS = 60_000

// Caddy issues a preview host's certificate on its first TLS handshake. Shaking hands
// while the stack boots keeps that issuance out of the first page load.
export function warmPreviewCertificates(sessionId: number): void {
  const hosts = readDdevHosts(sessionCheckoutDir(sessionId)).all
  const devServer = getSessionRow(sessionId)?.previewPort != null
  for (const origin of previewCertOrigins(sessionId, hosts, devServer)) {
    fetch(origin, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(ISSUE_TIMEOUT_MS) }).catch(() => {})
  }
}

export function previewCertOrigins(sessionId: number, hosts: string[], devServer: boolean): string[] {
  const labels = [undefined, ...hosts.slice(1).map(previewLabel), ...(devServer ? [devServerLabel(sessionId)] : [])]
  return labels
    .map(label => previewOrigin(sessionId, label))
    .filter((origin): origin is string => !!origin?.startsWith('https:'))
}
