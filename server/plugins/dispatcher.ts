import { dispatchRuns } from '../daemon/dispatcher'

// Safety net for the run dispatcher: enqueue points poke dispatchRuns()
// directly (instant starts); this interval only catches what a poke missed:
// queued rows from before a restart, or a poke lost to a crash mid-request.
// Interval-only (like the scheduler): the first tick lands after boot-time
// migrations/recovery have run.
export default defineNitroPlugin(() => {
  setInterval(dispatchRuns, 10_000)
})
