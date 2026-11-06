import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

Object.assign(globalThis, { defineNitroPlugin: (plugin: () => void) => plugin })
const checkSessionPassword = (await import('../../server/plugins/session-password')).default as unknown as () => void

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('session password check', () => {
  it('refuses to start with the placeholder from .env.example', () => {
    const placeholder = readFileSync('.env.example', 'utf8').match(/^NUXT_SESSION_PASSWORD=(.*)$/m)![1]!
    vi.stubEnv('NUXT_SESSION_PASSWORD', placeholder)
    expect(checkSessionPassword).toThrow(/still the placeholder/)
  })

  it('starts with a real password', () => {
    vi.stubEnv('NUXT_SESSION_PASSWORD', 'a'.repeat(64))
    expect(checkSessionPassword).not.toThrow()
  })
})
