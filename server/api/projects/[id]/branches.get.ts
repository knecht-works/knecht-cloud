import { listRepoBranches } from '../../../utils/github-app'
import { requireProject } from '../../../stores/projects'

export default defineEventHandler(async (event) => {
  const project = requireProject(requireIntParam(event))
  const names = await listRepoBranches(project.owner, project.name)

  return [
    ...names.filter(n => n === project.defaultBranch),
    ...names.filter(n => n !== project.defaultBranch).sort((a, b) => a.localeCompare(b)),
  ]
})
