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
  if (password.length < PASSWORD_MIN_LENGTH) return `At least ${PASSWORD_MIN_LENGTH} characters.`
  if (!/\p{Lu}/u.test(password)) return 'Add an uppercase letter.'
  if (!/\p{Ll}/u.test(password)) return 'Add a lowercase letter.'
  if (!/\d/.test(password)) return 'Add a digit.'
  return null
}

export const LAST_LOGIN_COOKIE = 'knecht-last-login'
export type LoginMethod = 'github' | 'password'
