import { getSettings } from '../utils/settings'

// GET /api/settings → the instance settings (self-seeds defaults on first
// read). The OpenRouter key never leaves the server — the UI only learns
// WHETHER one is configured.
export default defineEventHandler(() => {
  const { openrouterKeyEnc, ...settings } = getSettings()
  return { ...settings, aiKeyConfigured: !!openrouterKeyEnc }
})
