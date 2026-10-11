import { listRunSteps } from '../../../stores/run-steps'

export default defineEventHandler((event) => {
  return listRunSteps(requireIntParam(event))
})
