import { startUpdate } from '#server/daemon/update'
import { availableUpdate } from '#server/utils/version'
import { requireOwner } from '#server/utils/owner'
import { getSettings } from '#server/utils/settings'
import { defineEventHandler, createError } from 'h3'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const latest = await availableUpdate(getSettings().prereleaseUpdates)
  if (!latest) {
    throw createError({ statusCode: 409, statusMessage: 'No newer release available.' })
  }

  await startUpdate(latest)
  return { started: true, target: latest }
})
