import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project } from '../db/schema'
import { fetchDdevType, fetchFrameworkVersion, getGithubClient } from './github'

// Resolve missing `framework` values from each repo's `.ddev/config.yaml` and
// persist them, mutating the passed rows in place. Best-effort: if there's no
// session/token or a repo can't be read, the affected projects keep
// framework=null and the caller renders them without a framework chip. Once a
// value is stored there are no further GitHub calls for that project.
export async function backfillFrameworks(event: H3Event, projects: Project[]): Promise<void> {
  const missing = projects.filter(p => p.framework == null)
  if (!missing.length) return

  let octokit
  try {
    octokit = await getGithubClient(event)
  }
  catch {
    return
  }

  await Promise.all(missing.map(async (p) => {
    const type = await fetchDdevType(octokit, p.owner, p.name, p.defaultBranch)
    if (!type) return
    const version = await fetchFrameworkVersion(octokit, p.owner, p.name, type, p.defaultBranch)
    db.update(schema.projects)
      .set({ framework: type, frameworkVersion: version })
      .where(eq(schema.projects.id, p.id))
      .run()
    p.framework = type
    p.frameworkVersion = version
  }))
}
