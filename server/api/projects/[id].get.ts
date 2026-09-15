import { backfillFrameworks } from '../../utils/framework'
import { withLinks } from '../../utils/project-links'

export default defineEventHandler(async (event) => {
  const project = requireProject(requireIntParam(event))
  await backfillFrameworks([project])
  return withLinks([project])[0]
})
