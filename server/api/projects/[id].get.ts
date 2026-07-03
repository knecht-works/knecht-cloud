import { backfillFrameworks } from '../../utils/framework'

// GET /api/projects/:id → a single project. Resolves the framework from GitHub
// on the fly (best-effort) if it isn't known yet.
export default defineEventHandler(async (event) => {
  const project = requireProject(requireIntParam(event))
  await backfillFrameworks([project])
  return project
})
