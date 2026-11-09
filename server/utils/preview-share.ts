import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Project, Session } from '../db/schema'
import { shareLinkMaxMinutes, type PreviewAccess } from '../../shared/utils/preview-access'
import { deriveKey } from './crypto'
import { getSettings } from './settings'
import { touchSessionPreview, updateSession } from '../stores/sessions'
import { getProject } from '../stores/projects'

let cachedKey: Buffer | undefined
function shareKey(): Buffer {
  cachedKey ??= deriveKey('knecht-preview-share', 'hmac-token')
  return cachedKey
}

// Derived, not stored: the link stays the same for the session's whole life,
// and sharing it again only moves its expiry.
export function shareToken(sessionId: number): string {
  return createHmac('sha256', shareKey()).update(`share-${sessionId}`).digest('base64url')
}

export function shareCookieName(sessionId: number): string {
  return `knecht-share-${sessionId}`
}

export function shareTokenValid(session: Pick<Session, 'id' | 'shareExpiresAt'>, token: string | undefined): boolean {
  if (!token || !session.shareExpiresAt || session.shareExpiresAt.getTime() <= Date.now()) return false
  const expected = Buffer.from(shareToken(session.id))
  const given = Buffer.from(token)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// An unknown preset value falls back to login: a typo must not open every preview.
export function previewAccess(project: Pick<Project, 'previewAccess'>): PreviewAccess {
  return project.previewAccess ?? (getSettings().previewAccess === 'public' ? 'public' : 'login')
}

// Only for the preview app itself: the IDE and services always require a login.
export function guestAllowed(env: Session, shareCookie: string | undefined): boolean {
  const project = getProject(env.projectId)
  return (!!project && previewAccess(project) === 'public') || shareTokenValid(env, shareCookie)
}

export function cookieValue(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return undefined
}

// Touched so the link starts on a live env, which the idle reaper counts from now.
export function shareSession(sessionId: number, project: Pick<Project, 'shareLinkHours'>): { token: string, expiresAt: Date } {
  const settings = getSettings()
  const hours = project.shareLinkHours ?? settings.shareLinkHours
  const max = shareLinkMaxMinutes(settings)
  const minutes = hours === null ? max : Math.min(hours * 60, max)
  const expiresAt = new Date(Date.now() + minutes * 60_000)
  updateSession(sessionId, { shareExpiresAt: expiresAt })
  touchSessionPreview(sessionId)
  return { token: shareToken(sessionId), expiresAt }
}
