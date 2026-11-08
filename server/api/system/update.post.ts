import { startUpdate } from '../../daemon/update'
import { currentVersion, isNewerVersion, latestVersion } from '../../utils/version'
import { requireOwner } from '../../utils/owner'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const latest = await latestVersion()
  if (!latest || !isNewerVersion(latest, currentVersion())) {
    throw createError({ statusCode: 409, statusMessage: 'No newer release available.' })
  }

  await startUpdate(latest)
  return { started: true, target: latest }
})
