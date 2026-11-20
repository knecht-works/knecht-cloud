import { defineEventHandler, readBody } from 'h3'
import { updateMcpServer } from '#server/stores/mcp-servers'
import { mcpServerInput, mcpServerValues, mcpServerView, requireMcpServer } from '#server/utils/mcp-admin'
import { requireIntParam, zodBadRequest } from '#server/utils/http'
import { requireOwner } from '#server/utils/owner'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const existing = requireMcpServer(requireIntParam(event))
  const result = mcpServerInput.safeParse(await readBody(event))
  if (!result.success) zodBadRequest(result.error, 'Invalid MCP server')
  return mcpServerView(updateMcpServer(existing.id, mcpServerValues(existing.projectId, result.data, existing))!)
})
