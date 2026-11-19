import { getSystemInfo } from '#server/daemon/system'
import { defineEventHandler } from 'h3'

// Thin HTTP wrapper: GET /api/system → the daemon does the work.
export default defineEventHandler(async () => {
  return await getSystemInfo()
})
