import type { H3Event } from 'h3'

// Parse an integer route param (`[id]`-style) or fail the request with a 400.
export function requireIntParam(event: H3Event, name = 'id'): number {
  const value = Number(getRouterParam(event, name))
  if (!Number.isInteger(value)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid ${name}` })
  }
  return value
}
