import { previewLabel } from '../../shared/utils/preview-host'
import { readDdevConfig, readDdevHosts } from '../daemon/ddev'
import { exposedPorts, type ExposedPort } from '../daemon/sandbox'
import { getSessionRow } from './entities'
import { sessionCheckoutDir } from './storage'

export interface SessionService { label: string, container: string, port: number }

const MAILPIT_PORT = 8025
const RESERVED_LABELS = new Set(['ide'])

export function nameServices(
  exposed: ExposedPort[],
  { hosts, previewPort, extraPorts }: { hosts: string[], previewPort: number | null, extraPorts: { name: string, port: number }[] },
): SessionService[] {
  const taken = new Set([...RESERVED_LABELS, ...hosts.map(previewLabel)])
  const services: SessionService[] = []
  for (const { service, container, port } of exposed) {
    let name: string
    if (service === 'web') {
      // 80 is the preview, the dev server port is the dev origin.
      if (port === 80 || port === previewPort) continue
      name = port === MAILPIT_PORT ? 'mailpit' : extraPorts.find(p => p.port === port)?.name ?? `web-${port}`
    }
    else {
      name = services.some(s => s.container === container) ? `${service}-${port}` : service
    }
    const label = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!label || taken.has(label)) continue
    taken.add(label)
    services.push({ label, container, port })
  }
  return services
}

// The websocket upgrade hook is synchronous, so it can only read what an HTTP request already named.
const known = new Map<number, { exposed: ExposedPort[], services: SessionService[] }>()

export async function sessionServices(sessionId: number): Promise<SessionService[]> {
  const exposed = await exposedPorts(sessionId)
  const cached = known.get(sessionId)
  if (cached?.exposed === exposed) return cached.services
  const dir = sessionCheckoutDir(sessionId)
  const services = nameServices(exposed, {
    hosts: readDdevHosts(dir).all,
    previewPort: getSessionRow(sessionId)?.previewPort ?? null,
    extraPorts: readDdevConfig(dir)?.extraPorts ?? [],
  })
  known.set(sessionId, { exposed, services })
  return services
}

export async function findSessionService(sessionId: number, label: string): Promise<SessionService | undefined> {
  return (await sessionServices(sessionId)).find(s => s.label === label)
}

export function knownSessionService(sessionId: number, label: string): SessionService | undefined {
  return known.get(sessionId)?.services.find(s => s.label === label)
}
