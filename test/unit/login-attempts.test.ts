import { describe, expect, it } from 'vitest'
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from '../../server/utils/login-attempts'

describe('login attempts', () => {
  it('blocks after ten failures within 15 minutes, and forgets them afterwards', () => {
    const keys = ['user:a', 'ip:1']
    for (let i = 0; i < 9; i++) recordLoginFailure(keys, 0)
    expect(isLoginBlocked(keys, 0)).toBe(false)
    recordLoginFailure(keys, 0)
    expect(isLoginBlocked(keys, 0)).toBe(true)
    expect(isLoginBlocked(['user:b', 'ip:1'], 0)).toBe(true)
    expect(isLoginBlocked(keys, 15 * 60 * 1000)).toBe(false)
  })

  it('clears only the keys it is given', () => {
    for (let i = 0; i < 10; i++) recordLoginFailure(['user:c', 'ip:2'], 0)
    clearLoginFailures(['user:c'])
    expect(isLoginBlocked(['user:c'], 0)).toBe(false)
    expect(isLoginBlocked(['ip:2'], 0)).toBe(true)
  })
})
