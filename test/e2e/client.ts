// A tiny cookie-carrying HTTP client for the e2e suite: logs in through the
// dev-only /_test/login route (the same session machinery as the real OAuth
// callback) and speaks to the instance's real API from then on.

export const BASE_URL = (process.env.KNECHT_E2E_BASE_URL ?? 'http://lvh.me:3333').replace(/\/+$/, '')

export interface E2eClient {
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  login: string
}

export async function login(): Promise<E2eClient> {
  const secret = process.env.KNECHT_TEST_AUTH
  if (!secret) {
    throw new Error('Set KNECHT_TEST_AUTH to the dev-login secret of the target instance (and KNECHT_E2E_BASE_URL to its origin)')
  }
  const res = await fetch(`${BASE_URL}/_test/login?secret=${encodeURIComponent(secret)}`)
  if (!res.ok) {
    throw new Error(`Dev login at ${BASE_URL}/_test/login failed: ${res.status} ${res.statusText}`)
  }
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const { login } = await res.json() as { login: string }
  return {
    login,
    fetch: (path, init = {}) => fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { cookie, ...init.headers },
    }),
  }
}

// Small JSON helpers so tests read as scenario steps, failing with the
// response body when the API says no.
export async function expectJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.url} -> ${res.status}: ${await res.text()}`)
  return await res.json() as T
}
