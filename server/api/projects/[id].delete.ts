import { getProject } from '../../stores/projects'
import { requireElevated } from '../../utils/member-session'

export default defineEventHandler(async (event) => {
  await requireElevated(event)
  const id = requireIntParam(event)
  if (!getProject(id)) {
    return { ok: true }
  }
  deleteProject(id)
  return { ok: true }
})
