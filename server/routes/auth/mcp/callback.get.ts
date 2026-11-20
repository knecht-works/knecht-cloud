import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { getMcpServer, updateMcpServer } from '#server/stores/mcp-servers'
import { finishMcpOAuth, mcpSettingsPath } from '#server/utils/mcp-oauth'
import { popFlowCookie } from '#server/utils/flow-cookie'
import { requireOwner } from '#server/utils/owner'

export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const query = getQuery(event)
  const [id, expected] = (popFlowCookie(event, 'mcp-state') ?? '').split('.')
  const row = getMcpServer(Number(id))
  if (!row || !expected || query.state !== expected) return sendRedirect(event, '/settings/agent')

  try {
    if (typeof query.error === 'string') throw new Error(typeof query.error_description === 'string' ? query.error_description : query.error)
    if (typeof query.code !== 'string') throw new Error('the server sent no code')
    await finishMcpOAuth(row, query.code, owner.login)
  }
  catch (e) {
    updateMcpServer(row.id, { authError: `The sign-in failed: ${(e as Error).message}` })
  }
  return sendRedirect(event, mcpSettingsPath(row))
})
