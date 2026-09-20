import { createError, getRouterParam, type H3Event } from 'h3'
import { INTEGRATIONS, type Integration } from '../integrations'

export function connectionOf(event: H3Event): { integration: Integration, connection: NonNullable<Integration['connection']> } {
  const integration = INTEGRATIONS.find(i => i.id === getRouterParam(event, 'id'))
  if (!integration?.connection) {
    throw createError({ statusCode: 404, statusMessage: 'This integration has no connection' })
  }
  return { integration, connection: integration.connection }
}
