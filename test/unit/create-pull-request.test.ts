import { beforeEach, describe, expect, it, vi } from 'vitest'

const pulls = { create: vi.fn(), list: vi.fn() }

vi.mock('../../server/utils/github-credentials', () => ({ githubAppCredentials: () => ({ appId: '1', privateKey: 'k' }) }))
vi.mock('octokit', () => ({
  App: class {
    octokit = { rest: { apps: { getRepoInstallation: async () => ({ data: { id: 1 } }) } } }
    getInstallationOctokit = async () => ({ rest: { pulls } })
  },
}))

const { createPullRequest } = await import('../../server/utils/github-app')
const params = { title: 't', body: 'b', head: 'knecht/19', base: 'main' }

describe('createPullRequest', () => {
  beforeEach(() => {
    pulls.create.mockReset()
    pulls.list.mockReset()
  })

  it('reuses the open PR when one already exists for the branch', async () => {
    pulls.create.mockRejectedValue(new Error('Validation Failed: {"message":"A pull request already exists for acme:knecht/19."}'))
    pulls.list.mockResolvedValue({ data: [{ html_url: 'https://github.com/acme/app/pull/7', number: 7 }] })

    await expect(createPullRequest('acme', 'app', params)).resolves.toEqual({ url: 'https://github.com/acme/app/pull/7', number: 7, existing: true })
    expect(pulls.list).toHaveBeenCalledWith({ owner: 'acme', repo: 'app', head: 'acme:knecht/19', state: 'open' })
  })

  it('rethrows when the existing PR cannot be found', async () => {
    pulls.create.mockRejectedValue(new Error('A pull request already exists for acme:knecht/19.'))
    pulls.list.mockResolvedValue({ data: [] })

    await expect(createPullRequest('acme', 'app', params)).rejects.toThrow('A pull request already exists')
  })
})
