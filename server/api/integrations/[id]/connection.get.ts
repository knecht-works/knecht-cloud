import { keyPreview } from '../../../../shared/utils/key-preview'
import { connectionOf } from '../../../utils/integration-routes'
import { isOwner } from '../../../utils/owner'
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  const status = connectionOf(event).connection.store.status()
  if (!status.webhookSecret || await isOwner(event)) return status
  return { ...status, webhookSecret: keyPreview(status.webhookSecret) }
})
