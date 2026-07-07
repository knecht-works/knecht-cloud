import { startUpdate } from '../../daemon/update'
import { getMember } from '../../utils/members'
import { currentVersion, isNewerVersion, latestVersion } from '../../utils/version'

// POST /api/system/update → self-update to the latest release. A sibling
// updater container does the actual work (server/daemon/update.ts); this
// endpoint only authorizes and kicks it off, then the app container gets
// recreated underneath us. Owner-only: an update swaps the running code for
// every member.
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
