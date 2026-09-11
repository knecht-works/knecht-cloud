import { listRepoBranches } from '../../../../../utils/github-app'

export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner')
  const name = getRouterParam(event, 'name')
  if (!owner || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid repo' })
  }

  return listRepoBranches(owner, name)
})
