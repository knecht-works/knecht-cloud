import { listRepoBranches } from '../../../utils/github-app'

// GET /api/projects/:id/branches → the repo's branch names for the run branch
// picker, default branch first then alphabetical.
export default defineEventHandler(async (event) => {
  const project = requireProject(requireIntParam(event))
  const names = await listRepoBranches(project.owner, project.name)

  return [
    ...names.filter(n => n === project.defaultBranch),
    ...names.filter(n => n !== project.defaultBranch).sort((a, b) => a.localeCompare(b)),
  ]
})
