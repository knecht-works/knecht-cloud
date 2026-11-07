import { getMemberById, listIdentities } from '../../stores/members'
import { isGithubAppConfigured } from '../../utils/github-credentials'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const member = getMemberById(user.id)!
  const github = listIdentities(member.id).find(i => i.provider === 'github' && i.verified)
  return {
    password: !!member.passwordHash,
    github: { available: isGithubAppConfigured(), username: github?.username ?? null },
  }
})
