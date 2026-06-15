import { getSettings } from '../utils/settings'

// GET /api/settings → the instance settings (self-seeds defaults on first read).
export default defineEventHandler(() => getSettings())
