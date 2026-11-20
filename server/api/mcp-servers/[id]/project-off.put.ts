import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import { setMcpServerOffIn } from '#server/stores/mcp-servers'
import { requireProject } from '#server/stores/projects'
import { requireMcpServer } from '#server/utils/mcp-admin'
import { requireIntParam, zodBadRequest } from '#server/utils/http'
import { requireOwner } from '#server/utils/owner'

const input = z.object({ projectId: z.number().int(), off: z.boolean() })

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const server = requireMcpServer(requireIntParam(event))
  if (server.projectId !== null) throw createError({ statusCode: 400, statusMessage: 'Only a global server can be switched off in a project' })
  const result = input.safeParse(await readBody(event))
  if (!result.success) zodBadRequest(result.error, 'Invalid request')
  setMcpServerOffIn(requireProject(result.data.projectId).id, server.id, result.data.off)
  return { ok: true }
})
