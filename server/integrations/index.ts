import type { IntegrationId } from '#shared/utils/integrations'
import { github } from '#server/integrations/github'
import { jira } from '#server/integrations/jira'
import { linear } from '#server/integrations/linear'
import { plane } from '#server/integrations/plane'
import type { Integration } from '#server/integrations/types'

export type { CommentAuthor, DeliveryRecord, Integration, LinkTarget, ReplyTarget, TriggerMatch, WebhookComment, WebhookDelivery, WebhookHeaders } from '#server/integrations/types'

export const INTEGRATIONS: readonly Integration[] = [github, jira, plane, linear]

export function getIntegration(id: IntegrationId): Integration {
  const integration = INTEGRATIONS.find(i => i.id === id)
  if (!integration) throw new Error(`unknown integration: ${id}`)
  return integration
}
