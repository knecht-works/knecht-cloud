import { GIT_PROVIDERS } from '../../../../../git'

export default defineEventHandler(async (event) => {
  const owner = getRouterParam(event, 'owner')
  const name = getRouterParam(event, 'name')
  const branch = getQuery(event).branch
  if (!owner || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid repo' })
  }

  const { framework, frameworkVersion, ddevEnv } = await GIT_PROVIDERS.github.projectMeta(
    { repoProvider: 'github', owner, name, fullName: `${owner}/${name}` },
    typeof branch === 'string' && branch ? branch : undefined,
  )
  return { framework, frameworkVersion, ddevEnv }
})
