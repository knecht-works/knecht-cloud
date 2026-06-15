import { db, schema } from '../../db'
import { isBuiltin, listWorkflows } from '../../workflows'

// GET /api/workflows → the workflows for the overview + builder. Returns name,
// description and the normalized step sequence, plus `builtin` (ships in code)
// and `overridden` (a built-in that a DB row currently shadows) so the builder
// can offer "Reset to default". Run stats are derived client-side from /api/runs.
export default defineEventHandler(() => {
  const dbNames = new Set(db.select({ name: schema.workflows.name }).from(schema.workflows).all().map(r => r.name))
  return listWorkflows().map(w => ({
    name: w.name,
    description: w.description,
    steps: w.steps,
    builtin: isBuiltin(w.name),
    overridden: isBuiltin(w.name) && dbNames.has(w.name),
  }))
})
