import { parseWorkflow, type Workflow } from './schema'

// Default workflows ship inside the Knecht repo (workflows.md §11). They are
// embedded as YAML source — not read from disk — so they load identically in
// dev and in the bundled Nitro output, while still exercising the real
// yaml-parse → Zod-validate pipeline. Per-instance YAML storage and the visual
// builder that writes it are deferred (mvp.md §7).

const BOOT_AND_PREVIEW = `
name: boot-and-preview
description: Boot the project, install dependencies, import the DB, and preview it.
steps:
  - ddev-start
  - bash:
      command: ddev composer install
  - bash:
      command: ddev npm install && ddev npm run build
`

// Parsed + validated once at module load — a bad bundled definition fails fast
// on boot rather than at run time.
const registry: Map<string, Workflow> = new Map(
  [BOOT_AND_PREVIEW].map((yaml) => {
    const wf = parseWorkflow(yaml)
    return [wf.name, wf]
  }),
)

export function listWorkflows(): Workflow[] {
  return [...registry.values()]
}

export function getWorkflow(name: string): Workflow | undefined {
  return registry.get(name)
}
