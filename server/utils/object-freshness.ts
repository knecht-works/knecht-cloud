import type { Integration } from '../integrations'

const MAX_AGE_MS = 10 * 60_000

// In memory: after a restart every ticket is fetched once more.
const fetchedAt = new Map<number, Date>()

export function ticketFetched(sessionId: number, at: Date): void {
  fetchedAt.set(sessionId, at)
}

export function ticketChanged(sessionId: number): void {
  fetchedAt.delete(sessionId)
}

// The max age catches changes no webhook reports: an edited comment, a new relation, a linked ticket.
export function freshTicketSince(sessionId: number, integration: Integration): Date | null {
  const at = fetchedAt.get(sessionId)
  if (!at || Date.now() - at.getTime() > MAX_AGE_MS || !webhooksArriving(integration)) return null
  return at
}

// The same verdict the integrations page shows: without deliveries, a quiet ticket proves nothing.
function webhooksArriving(integration: Integration): boolean {
  const status = integration.connection?.store.status()
  if (!status?.webhookSecret || !status.lastDelivery) return false
  return !status.lastRejected || status.lastRejected.reason !== 'signature' || status.lastRejected.at < status.lastDelivery.at
}
