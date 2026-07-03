import { listMembers } from '../../utils/members'

// GET /api/members → the login allowlist (session-gated by the /api middleware).
export default defineEventHandler(() => listMembers())
