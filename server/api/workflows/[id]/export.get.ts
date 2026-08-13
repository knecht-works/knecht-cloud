import { publishStepsSchema, serializeWorkflow } from '../../../workflows/schema'

// GET /api/workflows/:id/export?format=yaml|json → the workflow's CURRENT
// state (the draft, falling back to the published steps) as a downloadable,
// versioned document (workflow-engine-plan.md D9). Exports match what the
// editor shows, so they run through the same strict validation as a manual
// run: an incomplete workflow has nothing exportable (the file would be
// rejected on re-import anyway). Ids come backfilled from the validation.
export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const row = requireWorkflowRow(id)

  const result = publishStepsSchema.safeParse(row.draftSteps ?? row.steps)
  if (!result.success) {
    zodBadRequest(result.error, 'Finish the workflow before exporting')
  }
  const format = getQuery(event).format === 'json' ? 'json' : 'yaml'

  setHeader(event, 'Content-Type', format === 'json' ? 'application/json; charset=utf-8' : 'application/yaml; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${row.name}.${format}"`)
  return serializeWorkflow(
    { name: row.name, description: row.description, steps: result.data },
    format,
  )
})
