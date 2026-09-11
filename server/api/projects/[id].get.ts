import { backfillFrameworks } from '../../utils/framework'

export default defineEventHandler(async (event) => {
  const project = requireProject(requireIntParam(event))
  await backfillFrameworks([project])
  return project
})
