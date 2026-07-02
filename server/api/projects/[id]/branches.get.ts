import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { getInstallationClient } from '../../../utils/github-app'

// GET /api/projects/:id/branches → the repo's branch names for the run branch
// picker, default branch first then alphabetical.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()
  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  const octokit = await getInstallationClient(project.owner, project.name)
  const res = await octokit.request('GET /repos/{owner}/{repo}/branches', {
    owner: project.owner,
    repo: project.name,
    per_page: 100,
  })
  const names = res.data.map(b => b.name)

  return [
    ...names.filter(n => n === project.defaultBranch),
    ...names.filter(n => n !== project.defaultBranch).sort((a, b) => a.localeCompare(b)),
  ]
})
