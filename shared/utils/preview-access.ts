import { SETTINGS_LIMITS } from './settings-limits'

export const PREVIEW_ACCESS = ['login', 'public'] as const
export type PreviewAccess = (typeof PREVIEW_ACCESS)[number]

export const SHARE_PARAM = 'knecht-share'

// Up to the end of the stopped phase a visitor wakes the preview in seconds; an
// archived one takes minutes to restore. null: previews are never archived.
export function shareLinkCapMinutes(s: { idleStopMinutes: number, previewRetentionDays: number }): number | null {
  return s.previewRetentionDays > 0 ? s.idleStopMinutes + s.previewRetentionDays * 1440 : null
}

export function shareLinkMaxMinutes(s: { idleStopMinutes: number, previewRetentionDays: number }): number {
  return Math.min(SETTINGS_LIMITS.shareLinkHours.max * 60, shareLinkCapMinutes(s) ?? Infinity)
}
