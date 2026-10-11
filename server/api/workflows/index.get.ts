import { listWorkflowRows } from '../../stores/workflows'
import { ensureStepIds } from '../../../shared/utils/workflow'

// The draft is returned exactly as stored: the editor diffs against it.
export default defineEventHandler(() => {
  return listWorkflowRows()
    // Same deterministic id assignment as the engine, so steps.<id> outputs exist for pre-id rows.
    .map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      steps: ensureStepIds(row.steps),
      draftSteps: row.draftSteps,
      enabled: row.enabled,
      repliesEnabled: row.repliesEnabled,
      publishedAt: row.publishedAt,
    }))
})
