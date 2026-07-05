import { db, schema } from '../../db'
import { ensureStepIds } from '../../../shared/utils/workflow'

// GET /api/workflows → the workflows for the overview + builder: name,
// description, the normalized step sequence and the `enabled` automation switch.
// Every workflow is a plain row (starters are seeded on first boot). Run stats
// are derived client-side from /api/runs.
export default defineEventHandler(() => {
  return db
    .select({
      name: schema.workflows.name,
      description: schema.workflows.description,
      steps: schema.workflows.steps,
      enabled: schema.workflows.enabled,
    })
    .from(schema.workflows)
    .all()
    // Pre-id rows get ids backfilled (the same deterministic assignment the
    // engine uses), so the builder can offer steps.<id> outputs immediately.
    .map(row => ({ ...row, steps: ensureStepIds(row.steps) }))
})
