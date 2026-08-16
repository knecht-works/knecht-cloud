import { db, schema } from '../../db'
import { ensureStepIds } from '../../../shared/utils/workflow'

// GET /api/workflows → the workflows for the overview + builder: the published
// steps, the editor's draft (returned exactly as stored, the editor diffs
// against it), the `enabled` automation switch and when the workflow was last
// published (null = never, nothing to run in production). Every workflow is a
// plain row (starters are seeded on first boot). Run stats are derived
// client-side from /api/runs.
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
    // Pre-id rows get ids backfilled (the same deterministic assignment the
    // engine uses), so the builder can offer steps.<id> outputs immediately.
    .map(row => ({ ...row, steps: ensureStepIds(row.steps) }))
})
