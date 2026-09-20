import { connectionOf } from '../../../utils/integration-routes'

export default defineEventHandler((event) => {
  const { connection } = connectionOf(event)
  connection.store.remove()
  connection.onChange?.()
  return connection.store.status()
})
