import type { IntegrationId } from '../../shared/utils/integrations'
import { github } from './github'
import type { Integration } from './types'

export type { CommentAuthor, Integration, TriggerMatch, WebhookComment, WebhookDelivery, WebhookHeaders } from './types'

export const INTEGRATIONS: readonly Integration[] = [github]

export function getIntegration(id: IntegrationId): Integration {
  const integration = INTEGRATIONS.find(i => i.id === id)
  if (!integration) throw new Error(`unknown integration: ${id}`)
  return integration
}
