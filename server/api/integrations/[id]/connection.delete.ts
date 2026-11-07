import { connectionOf } from '../../../utils/integration-routes'
import { requireOwner } from '../../../utils/owner'
import { requireElevated } from '../../../utils/member-session'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  await requireElevated(event)
  const { connection } = connectionOf(event)
  connection.store.remove()
  connection.onChange?.()
  return connection.store.status()
})
