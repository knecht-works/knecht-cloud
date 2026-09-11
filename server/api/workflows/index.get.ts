import { db, schema } from '../../db'
import { ensureStepIds } from '../../../shared/utils/workflow'

// The draft is returned exactly as stored: the editor diffs against it.
export default defineEventHandler(() => {
  return db
    .select({
      id: schema.workflows.id,
      name: schema.workflows.name,
      description: schema.workflows.description,
      steps: schema.workflows.steps,
      draftSteps: schema.workflows.draftSteps,
      enabled: schema.workflows.enabled,
      repliesEnabled: schema.workflows.repliesEnabled,
      publishedAt: schema.workflows.publishedAt,
    })
    .from(schema.workflows)
    .all()
    // Same deterministic id assignment as the engine, so steps.<id> outputs exist for pre-id rows.
    .map(row => ({ ...row, steps: ensureStepIds(row.steps) }))
})
