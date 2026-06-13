import { listWorkflows } from '../workflows'

// GET /api/workflows → the bundled workflows, for the run picker. Name +
// description only; the step detail isn't needed by the UI yet.
export default defineEventHandler(() => {
  return listWorkflows().map(w => ({ name: w.name, description: w.description }))
})
