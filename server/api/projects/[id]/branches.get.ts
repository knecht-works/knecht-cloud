import { gitProvider } from '#server/git'
import { requireProject } from '#server/stores/projects'
import { defineEventHandler } from 'h3'
import { requireIntParam } from '#server/utils/http'

export default defineEventHandler(async (event) => {
  const project = requireProject(requireIntParam(event))
  const names = await gitProvider(project).listBranches(project)

  return [
    ...names.filter(n => n === project.defaultBranch),
    ...names.filter(n => n !== project.defaultBranch).sort((a, b) => a.localeCompare(b)),
  ]
})
