import { randomBytes } from 'node:crypto'
import { createError, defineEventHandler, getRequestURL, sendRedirect } from 'h3'
import { requireMcpServer } from '#server/utils/mcp-admin'
import { mcpSettingsPath, startMcpOAuth } from '#server/utils/mcp-oauth'
import { dashboardOrigin } from '#server/utils/origin'
import { setFlowCookie } from '#server/utils/flow-cookie'
import { updateMcpServer } from '#server/stores/mcp-servers'
import { requireIntParam } from '#server/utils/http'
import { requireOwner } from '#server/utils/owner'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const row = requireMcpServer(requireIntParam(event))
  if (row.auth !== 'oauth') throw createError({ statusCode: 400, statusMessage: `${row.name} does not sign in with OAuth` })
  const state = randomBytes(16).toString('hex')
  try {
    const url = await startMcpOAuth(row, `${dashboardOrigin() || getRequestURL(event).origin}/auth/mcp/callback`, state)
    setFlowCookie(event, 'mcp-state', `${row.id}.${state}`)
    return sendRedirect(event, url.toString())
  }
  catch (e) {
    updateMcpServer(row.id, { authError: `Could not start the sign-in: ${(e as Error).message}` })
    return sendRedirect(event, mcpSettingsPath(row))
  }
})
