import { connectionOf } from '../../../utils/integration-routes'
import { requireOwner } from '../../../utils/owner'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const { connection } = connectionOf(event)
  connection.store.remove()
  connection.onChange?.()
  return connection.store.status()
})
