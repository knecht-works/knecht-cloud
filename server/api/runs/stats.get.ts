import { listRunStats } from '../../stores/runs'

// Two 14-day windows plus a day of slack for the client's timezone.
const WINDOW_DAYS = 29

export default defineEventHandler(() => {
  return listRunStats(new Date(Date.now() - WINDOW_DAYS * 86_400_000))
})
