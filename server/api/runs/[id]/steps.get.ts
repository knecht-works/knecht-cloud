import { listRunSteps } from '../../../stores/run-steps'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler((event) => {
  return listRunSteps(requireIntParam(event))
})
