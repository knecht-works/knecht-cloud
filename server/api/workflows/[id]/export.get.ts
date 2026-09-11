import { publishStepsSchema, serializeWorkflow } from '../../../workflows/schema'

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
