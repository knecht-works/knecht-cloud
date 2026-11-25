import { requireTrigger } from '#server/stores/triggers'
import { fireTrigger } from '#server/utils/triggers'
import { defineEventHandler, createError } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  const trigger = requireTrigger(requireIntParam(event))
  if (trigger.source !== 'manual') {
    throw createError({ statusCode: 400, statusMessage: 'Only a manual trigger is started by hand' })
  }
  if (!trigger.active) {
    throw createError({ statusCode: 409, statusMessage: 'The trigger is paused' })
  }

  const runIds = fireTrigger(trigger)
  if (!runIds.length) {
    throw createError({ statusCode: 409, statusMessage: 'Nothing to run: the workflow must be published and enabled, and the trigger needs a project' })
  }
  return { runIds }
})
