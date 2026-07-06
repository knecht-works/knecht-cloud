import { getSettings, publicSettings } from '../utils/settings'

// GET /api/settings → the instance settings (self-seeds defaults on first
// read), in their redacted client shape.
export default defineEventHandler(() => publicSettings(getSettings()))
