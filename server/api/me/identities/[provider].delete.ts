import { REPO_PROVIDERS, type RepoProvider } from '../../../../shared/utils/integrations'
import { unlinkIdentity } from '../../../stores/members'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const provider = getRouterParam(event, 'provider') as RepoProvider
  if (!REPO_PROVIDERS.includes(provider)) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown provider.' })
  }
  if (!unlinkIdentity(user.id, provider)) {
    throw createError({ statusCode: 409, statusMessage: 'This is your only way to sign in, so it can’t be disconnected.' })
  }
  return { ok: true }
})
