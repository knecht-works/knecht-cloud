import { describe, expect, it } from 'vitest'
import { passwordProblem, safeRedirectPath, usernameProblem } from '#shared/utils/account'

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
  it.each(['Abcdefghijk1', 'Äöü-Straße-42', 'correct Horse 9 battery'])('accepts %s', (password) => {
    expect(passwordProblem(password)).toBeNull()
  })

  it.each([
    ['Abcdefghij1', 'At least 12 characters.'],
    ['abcdefghijk1', 'Add an uppercase letter.'],
    ['ABCDEFGHIJK1', 'Add a lowercase letter.'],
    ['Abcdefghijkl', 'Add a digit.'],
  ])('refuses %j', (password, problem) => {
    expect(passwordProblem(password)).toBe(problem)
  })
})

describe('safeRedirectPath', () => {
  it('keeps a local path with its query', () => {
    expect(safeRedirectPath('/projects?filter=stack:is:Craft%20CMS&sort=runs')).toBe('/projects?filter=stack:is:Craft%20CMS&sort=runs')
  })

  it('rejects anything that could leave the dashboard', () => {
    for (const raw of ['https://evil.test', '//evil.test', '/\\evil.test', 'projects', '', undefined, ['/projects']]) {
      expect(safeRedirectPath(raw)).toBeNull()
    }
  })

  it.each(['/\t/evil.test', '/\n/evil.test', '/\r/evil.test', '/\t\\evil.test', '/..//evil.test', '/.//evil.test', '/a/..//evil.test', '/%2e%2e//evil.test'])('rejects %j, which a browser resolves off-site', (raw) => {
    expect(safeRedirectPath(raw)).toBeNull()
  })
})
