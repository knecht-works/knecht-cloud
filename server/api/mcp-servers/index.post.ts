import { z } from 'zod'
import { defineEventHandler, readBody } from 'h3'
import { insertMcpServer } from '#server/stores/mcp-servers'
import { requireProject } from '#server/stores/projects'
import { mcpServerInput, mcpServerValues, mcpServerView } from '#server/utils/mcp-admin'
import { zodBadRequest } from '#server/utils/http'
import { requireOwner } from '#server/utils/owner'

const bodySchema = mcpServerInput.extend({ projectId: z.number().int().nullable() })

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) zodBadRequest(result.error, 'Invalid MCP server')
  const { projectId, ...input } = result.data
  if (projectId !== null) requireProject(projectId)
  return mcpServerView(insertMcpServer({ projectId, ...mcpServerValues(projectId, input) }))
})
