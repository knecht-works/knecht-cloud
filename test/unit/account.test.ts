import { describe, expect, it } from 'vitest'
import { passwordProblem, usernameProblem } from '../../shared/utils/account'

describe('usernameProblem', () => {
  it.each(['samuel', 'Samuel.Reichor', 'samuel_reichor', 'samuel--r', 'a', 'octo-cat', 'x'.repeat(39)])('accepts %s', (name) => {
    expect(usernameProblem(name)).toBeNull()
  })

  it.each([
    ['', 'Enter a username.'],
    ['x'.repeat(40), 'At most 39 characters.'],
    ['sam uel', 'Only letters, digits, dots, hyphens and underscores.'],
    ['samuel@example.com', 'Only letters, digits, dots, hyphens and underscores.'],
    ['-samuel', 'Start and end with a letter or digit.'],
    ['samuel.', 'Start and end with a letter or digit.'],
    ['_', 'Start and end with a letter or digit.'],
  ])('refuses %j', (name, problem) => {
    expect(usernameProblem(name)).toBe(problem)
  })
})

describe('passwordProblem', () => {
  it('asks for at least 12 characters', () => {
    expect(passwordProblem('x'.repeat(11))).toBe('At least 12 characters.')
    expect(passwordProblem('x'.repeat(12))).toBeNull()
  })
})
