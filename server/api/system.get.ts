import { getSystemInfo } from '../daemon/system'

// Thin HTTP wrapper: GET /api/system → the daemon does the work.
export default defineEventHandler(async () => {
  return await getSystemInfo()
})
