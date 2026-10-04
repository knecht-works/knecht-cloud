import { describe, expect, it } from 'vitest'
import { ideConnectionToken, withIdeTokenCookie } from '../../server/daemon/ide'

describe('IDE connection token', () => {
  it('is stable per session and differs between sessions', () => {
    expect(ideConnectionToken(7)).toMatch(/^[0-9a-f]{64}$/)
    expect(ideConnectionToken(7)).toBe(ideConnectionToken(7))
    expect(ideConnectionToken(8)).not.toBe(ideConnectionToken(7))
  })

  it('adds the token cookie and keeps the others', () => {
    expect(withIdeTokenCookie(undefined, 7)).toBe(`vscode-tkn=${ideConnectionToken(7)}`)
    expect(withIdeTokenCookie('a=1; b=2', 7)).toBe(`a=1; b=2; vscode-tkn=${ideConnectionToken(7)}`)
  })

  it('replaces a stale token cookie from the browser', () => {
    expect(withIdeTokenCookie(`vscode-tkn=${ideConnectionToken(8)}; a=1`, 7)).toBe(`a=1; vscode-tkn=${ideConnectionToken(7)}`)
  })
})
