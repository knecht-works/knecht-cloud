import { requireElevated } from '../../utils/member-session'

// Lets the dashboard confirm the member before a step that leaves the page, like connecting GitHub.
export default defineEventHandler(async (event) => {
  await requireElevated(event)
  return { ok: true }
})
