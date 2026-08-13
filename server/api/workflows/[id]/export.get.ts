import { ensureStepIds } from '../../../../shared/utils/workflow'
import { serializeWorkflow } from '../../../workflows/schema'

// GET /api/workflows/:id/export?format=yaml|json → the PUBLISHED version as a
// downloadable, versioned document (workflow-engine-plan.md D9). The draft is
// never exported; a workflow with no published steps has nothing to export
// (and the file would be rejected on re-import anyway). Ids are backfilled so
// the exported file always names its steps.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const row = requireWorkflowRow(id)
  if (!row.steps.length) {
    throw createError({ statusCode: 400, statusMessage: 'Publish the workflow before exporting' })
  }
  const format = getQuery(event).format === 'json' ? 'json' : 'yaml'

  setHeader(event, 'Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'application/yaml; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${row.name}.${format}"`)
  return serializeWorkflow(
    { name: row.name, description: row.description, steps: ensureStepIds(row.steps) },
    format,
  )
})
