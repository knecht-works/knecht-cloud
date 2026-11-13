import { rmSync } from 'node:fs'
import { setProjectDump, requireProject } from '../../../stores/projects'
import { dropDbBase } from '../../../daemon/db-base'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const project = requireProject(id)

  if (project.dbDumpPath) {
    try {
      rmSync(project.dbDumpPath)
    }
    catch {
      // Already gone.
    }
  }

  dropDbBase(id)
  return setProjectDump(id, null)
})
