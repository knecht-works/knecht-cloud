import type { H3Event } from 'h3'

// Parse an integer route param (`[id]`-style) or fail the request with a 400.
export function requireIntParam(event: H3Event, name = 'id'): number {
  const value = Number(getRouterParam(event, name))
  if (!Number.isInteger(value)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid ${name}` })
  }
  return value
}

// Fail the request with a 400 built from a Zod error's first issue, prefixed
// with the issue's path (`steps.2.command: Required`) so validation errors
// point at the offending field.
export function zodBadRequest(error: { issues: { path: PropertyKey[], message: string }[] }, fallback: string): never {
  const issue = error.issues[0]
  const at = issue?.path.length ? `${issue.path.join('.')}: ` : ''
  throw createError({ statusCode: 400, statusMessage: issue ? `${at}${issue.message}` : fallback })
}
