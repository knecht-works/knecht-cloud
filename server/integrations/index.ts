import type { IntegrationId } from '../../shared/utils/integrations'
import { github } from './github'
import { jira } from './jira'
import { linear } from './linear'
import { plane } from './plane'
import type { Integration } from './types'

export type { CommentAuthor, DeliveryRecord, Integration, LinkTarget, TriggerMatch, WebhookComment, WebhookDelivery, WebhookHeaders } from './types'

export const INTEGRATIONS: readonly Integration[] = [github, jira, plane, linear]

export function getIntegration(id: IntegrationId): Integration {
  const integration = INTEGRATIONS.find(i => i.id === id)
  if (!integration) throw new Error(`unknown integration: ${id}`)
  return integration
}
