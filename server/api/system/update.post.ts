import { startUpdate } from '../../daemon/update'
import { getMember } from '../../utils/members'
import { currentVersion, isNewerVersion, latestVersion } from '../../utils/version'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  if (!getMember(user.login)?.isOwner) {
    throw createError({ statusCode: 403, statusMessage: 'Only the owner can update.' })
  }

  const latest = await latestVersion()
  if (!latest || !isNewerVersion(latest, currentVersion())) {
    throw createError({ statusCode: 409, statusMessage: 'No newer release available.' })
  }

  await startUpdate(latest)
  return { started: true, target: latest }
})
