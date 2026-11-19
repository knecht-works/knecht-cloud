import { dispatchRuns } from '#server/daemon/dispatcher'
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin(() => {
  setInterval(dispatchRuns, 10_000)
})
