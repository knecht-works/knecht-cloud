import { startUpdate } from '#server/daemon/update'
import { currentVersion, isNewerVersion, latestVersion } from '#server/utils/version'
import { requireOwner } from '#server/utils/owner'
import { defineEventHandler, createError } from 'h3'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const latest = await latestVersion()
  if (!latest || !isNewerVersion(latest, currentVersion())) {
    throw createError({ statusCode: 409, statusMessage: 'No newer release available.' })
  }

  await startUpdate(latest)
  return { started: true, target: latest }
})
