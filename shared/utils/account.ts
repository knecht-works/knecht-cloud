export const PASSWORD_MIN_LENGTH = 12
const USERNAME_MAX_LENGTH = 39

// Wide enough that every GitHub login fits, so GitHub members keep theirs as username.
export function usernameProblem(username: string): string | null {
  if (!username) return 'Enter a username.'
  if (username.length > USERNAME_MAX_LENGTH) return `At most ${USERNAME_MAX_LENGTH} characters.`
  if (!/^[\w.-]+$/.test(username)) return 'Only letters, digits, dots, hyphens and underscores.'
  if (!/^[a-z\d](?:.*[a-z\d])?$/i.test(username)) return 'Start and end with a letter or digit.'
  return null
}

export function passwordProblem(password: string): string | null {
  return password.length < PASSWORD_MIN_LENGTH ? `At least ${PASSWORD_MIN_LENGTH} characters.` : null
}

export const LAST_LOGIN_COOKIE = 'knecht-last-login'
export type LoginMethod = 'github' | 'password'
