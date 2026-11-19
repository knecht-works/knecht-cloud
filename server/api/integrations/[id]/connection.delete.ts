import { connectionOf } from '../../../utils/integration-routes'
import { requireOwner } from '../../../utils/owner'
import { defineEventHandler } from 'h3'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const { connection } = connectionOf(event)
  connection.store.remove()
  connection.onChange?.()
  return connection.store.status()
})
