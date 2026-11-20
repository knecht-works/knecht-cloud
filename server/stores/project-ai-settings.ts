import { eq, isNull, sql } from 'drizzle-orm'
import { db, schema, type Executor } from '#server/db'
import type { ProjectAiSettings, Settings } from '#server/db/schema'
import { liveTopics } from '#shared/utils/live-topics'
import { emitTopics } from '#server/utils/live'

export type ProjectAiValues = Omit<ProjectAiSettings, 'projectId' | 'updatedAt'>

export function getProjectAiSettings(projectId: number): ProjectAiSettings | undefined {
  return db.select().from(schema.projectAiSettings).where(eq(schema.projectAiSettings.projectId, projectId)).get()
}

export function setProjectAiSettings(projectId: number, values: ProjectAiValues, tx: Executor = db): ProjectAiSettings | undefined {
  if (Object.values(values).every(v => v === null)) {
    deleteProjectAiSettings(projectId, tx)
    return undefined
  }
  const row = tx.insert(schema.projectAiSettings)
    .values({ projectId, ...values })
    .onConflictDoUpdate({ target: schema.projectAiSettings.projectId, set: { ...values, updatedAt: sql`(unixepoch())` } })
    .returning()
    .get()
  emitTopics(liveTopics.project(projectId))
  return row
}

export function deleteProjectAiSettings(projectId: number, tx: Executor = db): void {
  tx.delete(schema.projectAiSettings).where(eq(schema.projectAiSettings.projectId, projectId)).run()
  emitTopics(liveTopics.project(projectId))
}

// Overrides under the inherited provider only make sense for that provider. When the global
// one changes, a project with its own key stays on the previous provider, the others drop
// their model overrides and follow.
export function detachFromGlobalProvider(previous: Pick<Settings, 'aiProvider' | 'aiRegion' | 'aiModel' | 'aiSubtaskModel'>, tx: Executor = db): void {
  const rows = tx.select().from(schema.projectAiSettings).where(isNull(schema.projectAiSettings.aiProvider)).all()
  for (const { projectId, aiKeyEnc, aiModel, aiSubtaskModel } of rows) {
    setProjectAiSettings(projectId, aiKeyEnc
      ? {
          aiProvider: previous.aiProvider,
          aiRegion: previous.aiRegion,
          aiKeyEnc,
          aiModel: aiModel ?? previous.aiModel,
          aiSubtaskModel: aiSubtaskModel ?? previous.aiSubtaskModel,
        }
      : { aiProvider: null, aiRegion: null, aiKeyEnc: null, aiModel: null, aiSubtaskModel: null }, tx)
  }
}
