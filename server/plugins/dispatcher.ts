import { dispatchRuns } from '../daemon/dispatcher'

export default defineNitroPlugin(() => {
  setInterval(dispatchRuns, 10_000)
})
