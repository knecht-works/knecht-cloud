import { ensureStepIds } from '../../../../shared/utils/workflow'
import { serializeWorkflow } from '../../../workflows/schema'

// GET /api/workflows/:name/export?format=yaml|json → the workflow as a
// downloadable, versioned document (workflow-engine-plan.md D9). Ids are
// backfilled so the exported file always names its steps.
export default defineEventHandler((event) => {
  const name = decodeURIComponent(getRouterParam(event, 'name') ?? '')
  const row = requireWorkflowRow(name)
  const format = getQuery(event).format === 'json' ? 'json' : 'yaml'

  setHeader(event, 'Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'application/yaml; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${row.name}.${format}"`)
  return serializeWorkflow(
    { name: row.name, description: row.description, steps: ensureStepIds(row.steps) },
    format,
  )
})
