import type { H3Event } from 'h3'
import { LAST_LOGIN_COOKIE, type LoginMethod } from '../../shared/utils/account'

// Readable by the login page, which marks the method as last used.
export function rememberLoginMethod(event: H3Event, method: LoginMethod): void {
  setCookie(event, LAST_LOGIN_COOKIE, method, {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
}
