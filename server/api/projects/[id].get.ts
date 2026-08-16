import { backfillFrameworks } from '../../utils/framework'
import { appSlug } from '../../utils/mentions'

// GET /api/projects/:id → a single project. Resolves the framework from GitHub
// on the fly (best-effort) if it isn't known yet. `mentionHandle` is the
// instance's GitHub App slug: the name a comment must @-mention, surfaced so
// the settings page can show the exact handle instead of leaving people to
// guess (and ping some unrelated GitHub user).
export default defineEventHandler(async (event) => {
  const project = requireProject(requireIntParam(event))
  await backfillFrameworks([project])
  return { ...project, mentionHandle: appSlug() }
})
