import { deleteWorkflow, requireWorkflowRow } from '../../stores/workflows'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)

  requireWorkflowRow(id)

  return { ok: true, ...deleteWorkflow(id) }
})
