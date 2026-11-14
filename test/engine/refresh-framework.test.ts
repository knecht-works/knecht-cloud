import { describe, expect, it, vi } from 'vitest'
import { makeProject } from '../helpers/db'

const projectMeta = vi.fn()
vi.mock('../../server/git', () => ({ gitProvider: () => ({ projectMeta }) }))

const { refreshFramework } = await import('../../server/utils/framework')
const { requireProject } = await import('../../server/stores/projects')

describe('refreshFramework', () => {
  it('stores the framework version found on the default branch', async () => {
    const project = makeProject({ framework: 'craftcms', frameworkVersion: '4.9', favicon: 'icon' })
    projectMeta.mockResolvedValueOnce({ framework: 'craftcms', frameworkVersion: '5.4', favicon: '', ddevEnv: {} })

    await refreshFramework(project)

    expect(projectMeta).toHaveBeenLastCalledWith(project, 'main')
    expect(requireProject(project.id)).toMatchObject({ framework: 'craftcms', frameworkVersion: '5.4', favicon: 'icon' })
  })
})
