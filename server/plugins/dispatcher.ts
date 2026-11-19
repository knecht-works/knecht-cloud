import { dispatchRuns } from '../daemon/dispatcher'
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin(() => {
  setInterval(dispatchRuns, 10_000)
})
