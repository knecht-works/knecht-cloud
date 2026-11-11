import { describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'

vi.mock('../../server/git', () => ({
  gitProvider: () => ({ projectMeta: async () => { throw new Error('offline') } }),
}))

const { requireProject } = await import('../../server/stores/projects')
const handler = (await import('../../server/api/projects/index.post')).default

let nextRepoId = 9000
function repo() {
  const id = nextRepoId++
  return { repoProvider: 'github', repoId: String(id), owner: 'knecht-works', name: `repo-${id}`, fullName: `knecht-works/repo-${id}`, defaultBranch: 'main', private: false }
}

describe('POST /api/projects', () => {
  it('creates the project with the setup config in one go', async () => {
    const res = await callRoute(handler, {
      body: {
        ...repo(),
        envVars: [{ key: 'APP_ENV', value: 'local' }],
        bootCommands: 'pnpm install',
        database: 'mysql:8.0',
        devServer: 'pnpm dev',
        previewPort: 3000,
      },
    })
    expect(res.status).toBe(200)
    const project = requireProject((res.json as { id: number }).id)
    expect(project).toMatchObject({
      envVars: [{ key: 'APP_ENV', value: 'local' }],
      bootCommands: 'pnpm install',
      database: 'mysql:8.0',
      devServer: 'pnpm dev',
      previewPort: 3000,
    })
  })

  it('refuses a dev server without a preview port', async () => {
    const res = await callRoute(handler, { body: { ...repo(), devServer: 'pnpm dev' } })
    expect(res.status).toBe(400)
  })
})
