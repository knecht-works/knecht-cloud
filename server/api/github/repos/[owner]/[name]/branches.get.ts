import { GIT_PROVIDERS } from '../../../../../git'

export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner')
  const name = getRouterParam(event, 'name')
  if (!owner || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid repo' })
  }

  return GIT_PROVIDERS.github.listBranches({ repoProvider: 'github', owner, name, fullName: `${owner}/${name}` })
})
