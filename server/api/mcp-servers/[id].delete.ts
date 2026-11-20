import { defineEventHandler } from 'h3'
import { deleteMcpServer } from '#server/stores/mcp-servers'
import { requireIntParam } from '#server/utils/http'
import { requireOwner } from '#server/utils/owner'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  deleteMcpServer(requireIntParam(event))
  return { ok: true }
})
