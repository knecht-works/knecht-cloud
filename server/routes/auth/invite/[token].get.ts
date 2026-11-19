import { findOpenInvite } from '../../../stores/invites'
import { isGithubAppConfigured } from '../../../utils/github-credentials'
import { defineEventHandler, getRouterParam, createError } from 'h3'

export default defineEventHandler((event) => {
  const invite = findOpenInvite(getRouterParam(event, 'token') ?? '')
  if (!invite) {
    throw createError({ statusCode: 404, statusMessage: 'This invite link is invalid or has expired.' })
  }
  return { invitedBy: invite.createdBy, expiresAt: invite.expiresAt, github: isGithubAppConfigured() }
})
