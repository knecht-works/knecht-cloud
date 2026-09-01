// DELETE /api/projects/:id → disconnect a project (utils/projects.ts). The
// rows are gone when this returns; the envs, checkouts and archives are torn
// down in the background, which can take a while per session.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  if (!getProject(id)) {
    return { ok: true }
  }
  deleteProject(id)
  return { ok: true }
})
