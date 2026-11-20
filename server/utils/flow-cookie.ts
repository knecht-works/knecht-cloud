import type { H3Event } from 'h3'
import { deleteCookie, getCookie, setCookie } from 'h3'

// __Host- cookies cannot be planted by a preview subdomain, so a callback only
// completes a flow this browser started here. Plain http (dev) cannot set them.
const secure = process.env.NODE_ENV === 'production'
const flowCookie = (name: string) => `${secure ? '__Host-' : ''}knecht-${name}`

export function setFlowCookie(event: H3Event, name: string, value: string) {
  setCookie(event, flowCookie(name), value, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 600 })
}

export function popFlowCookie(event: H3Event, name: string): string | undefined {
  const value = getCookie(event, flowCookie(name))
  deleteCookie(event, flowCookie(name), { secure, path: '/' })
  return value
}
