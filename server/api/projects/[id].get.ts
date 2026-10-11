import { backfillFrameworks } from '../../utils/framework'
import { withLinks } from '../../utils/project-links'
import { requireProject } from '../../stores/projects'

export default defineEventHandler(async (event) => {
  const project = requireProject(requireIntParam(event))
  await backfillFrameworks([project])
  return withLinks([project])[0]
})
