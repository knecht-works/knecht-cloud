import { describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { makeProject } from '../helpers/db'

const listBranches = vi.fn(async () => ['main', 'develop'])
const projectMeta = vi.fn(async () => ({ framework: 'craftcms', frameworkVersion: '5.4', ddevEnv: {} }))
vi.mock('#server/git', () => ({ gitProvider: () => ({ listBranches, projectMeta }) }))

const patch = (await import('#server/api/projects/[id].patch')).default
const { requireProject } = await import('#server/stores/projects')

function update(id: number, body: object) {
  return callRoute(patch, { method: 'PATCH', route: '/projects/:id', path: `/projects/${id}`, body })
}

describe('PATCH /api/projects/:id defaultBranch', () => {
  it('switches to a branch of the repository and reads the framework from it', async () => {
    const project = makeProject()
    const res = await update(project.id, { defaultBranch: 'develop' })
    expect(res.status).toBe(200)
    expect(requireProject(project.id).defaultBranch).toBe('develop')
    await vi.waitFor(() => expect(projectMeta).toHaveBeenLastCalledWith(expect.objectContaining({ id: project.id }), 'develop'))
  })

  it('refuses a branch the repository does not have', async () => {
    const project = makeProject()
    const res = await update(project.id, { defaultBranch: 'gone' })
    expect(res.status).toBe(400)
    expect(res.json).toMatchObject({ statusMessage: 'Branch gone does not exist in knecht-works/test-php' })
    expect(requireProject(project.id).defaultBranch).toBe('main')
  })
})
