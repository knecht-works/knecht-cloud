import { describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import { makeProject } from '../helpers/db'

vi.mock('../../server/utils/github-app', () => ({}))

const handler = (await import('../../server/api/projects/[id]/link.put')).default
const { linkedProject, projectLinks } = await import('../../server/utils/project-links')

const put = (projectId: number, body: object) =>
  callRoute(handler, { method: 'PUT', route: '/:id', path: `/${projectId}`, body })

describe('PUT /api/projects/:id/link', () => {
  it('links, re-links and unlinks a project', async () => {
    const project = makeProject()
    expect((await put(project.id, { integration: 'jira', key: 'ONE' })).json).toEqual({ jira: 'ONE' })
    expect(linkedProject('jira', 'ONE')?.id).toBe(project.id)
    expect((await put(project.id, { integration: 'jira', key: 'TWO' })).json).toEqual({ jira: 'TWO' })
    expect(linkedProject('jira', 'ONE')).toBeUndefined()
    expect((await put(project.id, { integration: 'jira', key: null })).json).toEqual({})
    expect(projectLinks(project.id)).toEqual({})
  })

  it('refuses a target that already feeds another project', async () => {
    const first = makeProject()
    const second = makeProject()
    await put(first.id, { integration: 'jira', key: 'TAKEN' })
    const res = await put(second.id, { integration: 'jira', key: 'TAKEN' })
    expect(res.status).toBe(400)
    expect(res.json).toMatchObject({ statusMessage: 'Jira project TAKEN is already linked to knecht-works/test-php' })
  })

  it('refuses integrations without project links', async () => {
    const res = await put(makeProject().id, { integration: 'github', key: 'x' })
    expect(res.status).toBe(400)
  })
})
