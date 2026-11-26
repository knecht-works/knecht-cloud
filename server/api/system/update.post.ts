import { startUpdate } from '#server/daemon/update'
import { currentVersion, isNewerVersion, latestVersion } from '#server/utils/version'
import { requireOwner } from '#server/utils/owner'
import { getSettings } from '#server/utils/settings'
import { defineEventHandler, createError } from 'h3'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const { prereleaseUpdates } = getSettings()
  const latest = await latestVersion(prereleaseUpdates)
  if (!latest || !isNewerVersion(latest, currentVersion(), prereleaseUpdates)) {
    throw createError({ statusCode: 409, statusMessage: 'No newer release available.' })
  }

  await startUpdate(latest)
  return { started: true, target: latest }
})
