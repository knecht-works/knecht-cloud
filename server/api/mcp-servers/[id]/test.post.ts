import { createError, defineEventHandler } from 'h3'
import { mcpHeaders, mcpServerUrl, probeMcpServer } from '#server/utils/mcp'
import { requireMcpServer } from '#server/utils/mcp-admin'
import { requireIntParam } from '#server/utils/http'
import { requireOwner } from '#server/utils/owner'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const row = requireMcpServer(requireIntParam(event))
  try {
    const headers = await mcpHeaders(row)
    return { tools: await probeMcpServer(mcpServerUrl(row), Object.fromEntries(headers.map(h => [h.name, h.value]))) }
  }
  catch (e) {
    throw createError({ statusCode: 502, statusMessage: `Could not reach ${row.name}: ${(e as Error).message}` })
  }
})
