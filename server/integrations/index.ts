import type { IntegrationId } from '../../shared/utils/integrations'
import { github } from './github'
import { jira } from './jira'
import type { Integration } from './types'

export type { CommentAuthor, DeliveryRecord, Integration, LinkTarget, TriggerMatch, WebhookComment, WebhookDelivery, WebhookHeaders } from './types'

export const INTEGRATIONS: readonly Integration[] = [github, jira]

export function getIntegration(id: IntegrationId): Integration {
  const integration = INTEGRATIONS.find(i => i.id === id)
  if (!integration) throw new Error(`unknown integration: ${id}`)
  return integration
}
