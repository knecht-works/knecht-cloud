import { getProject } from '../../stores/projects'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'
import { deleteProject } from '#server/utils/projects'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  if (!getProject(id)) {
    return { ok: true }
  }
  deleteProject(id)
  return { ok: true }
})
