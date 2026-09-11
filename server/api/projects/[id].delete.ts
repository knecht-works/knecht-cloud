export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  if (!getProject(id)) {
    return { ok: true }
  }
  deleteProject(id)
  return { ok: true }
})
