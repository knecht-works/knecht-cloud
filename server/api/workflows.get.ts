import { listWorkflows } from '../workflows'

// GET /api/workflows → the bundled workflows for the overview + builder. Returns
// name, description and the step sequence (so the UI can render the step chain
// and the builder); run stats are derived client-side from /api/runs.
export default defineEventHandler(() => {
  return listWorkflows().map(w => ({
    name: w.name,
    description: w.description,
    steps: w.steps,
  }))
})
