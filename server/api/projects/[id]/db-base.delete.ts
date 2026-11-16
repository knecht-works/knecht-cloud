import { getProject, requireProject } from '../../../stores/projects'
import { dropDbBase } from '../../../daemon/db-base'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  requireProject(id)
  dropDbBase(id)
  return getProject(id)
})
