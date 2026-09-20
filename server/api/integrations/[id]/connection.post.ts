import { connectionIssues, normalizeConnection } from '../../../../shared/utils/connection-form'
import { connectionOf } from '../../../utils/integration-routes'

export default defineEventHandler(async (event) => {
  const { connection } = connectionOf(event)
  const body = await readBody(event)
  const values = normalizeConnection(connection.form, body && typeof body === 'object' ? body : {})
  const [issue] = Object.values(connectionIssues(connection.form, values))
  if (issue) {
    throw createError({ statusCode: 400, statusMessage: issue })
  }

  let me: { displayName: string, accountId: string }
  try {
    me = await connection.verify(values)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: connection.form.rejected })
  }

  connection.store.save(values, { accountName: me.displayName, accountId: me.accountId })
  connection.onChange?.()
  return connection.store.status()
})
