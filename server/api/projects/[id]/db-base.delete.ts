import { getProject, requireProject } from '#server/stores/projects'
import { dropDbBase } from '#server/daemon/db-base'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  requireProject(id)
  dropDbBase(id)
  return getProject(id)
})
