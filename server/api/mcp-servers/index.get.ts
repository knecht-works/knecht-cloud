import { defineEventHandler, getQuery } from 'h3'
import { listMcpServers, mcpServersOffIn } from '#server/stores/mcp-servers'
import { requireProject } from '#server/stores/projects'
import { mcpServerView } from '#server/utils/mcp-admin'

export default defineEventHandler((event) => {
  const { projectId } = getQuery(event)
  const global = listMcpServers(null).map(mcpServerView)
  if (projectId === undefined) return { servers: global, global: [], offHere: [] }
  const project = requireProject(Number(projectId))
  return { servers: listMcpServers(project.id).map(mcpServerView), global, offHere: mcpServersOffIn(project.id) }
})
