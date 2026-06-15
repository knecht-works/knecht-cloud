import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { parseWorkflow, type Workflow } from './schema'

// Default workflows ship inside the Knecht repo (workflows.md §11). They are
// embedded as YAML source — not read from disk — so they load identically in
// dev and in the bundled Nitro output, while still exercising the real
// yaml-parse → Zod-validate pipeline. User-created/edited workflows are stored
// in the DB (`workflows` table); a DB row with the same name OVERRIDES its
// built-in, and deleting that row reverts to the built-in.

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

// A self-contained demo of the git blocks + variable passing: it makes a small
// change, branches, commits, and opens a real PR — no ddev boot needed, so it
// runs fast and shows the front-to-back {{ run.id }} flow producing a PR.
const DEMO_PR = `
name: demo-pr
description: Make a small change and open a PR — demonstrates the git blocks and variable passing.
steps:
  - create-branch:
      name: knecht/demo-{{ run.id }}
  - bash:
      command: date > .knecht-demo.txt
  - create-commit:
      message: "Knecht demo change (run {{ run.id }})"
  - create-pr:
      title: "Knecht demo (run {{ run.id }})"
      description: |
        Automated demo change by Knecht — run {{ run.id }} on {{ project.name }}.
`

// Parsed + validated once at module load — a bad bundled definition fails fast
// on boot rather than at run time.
const BUILTINS: Map<string, Workflow> = new Map(
  [BOOT_AND_PREVIEW, DEMO_PR].map((yaml) => {
    const wf = parseWorkflow(yaml)
    return [wf.name, wf]
  }),
)

export function isBuiltin(name: string): boolean {
  return BUILTINS.has(name)
}

function rowToWorkflow(row: typeof schema.workflows.$inferSelect): Workflow {
  return { name: row.name, description: row.description, steps: row.steps }
}

// DB rows first, then every built-in that isn't overridden by a DB row.
export function listWorkflows(): Workflow[] {
  const rows = db.select().from(schema.workflows).all()
  const dbNames = new Set(rows.map(r => r.name))
  return [
    ...rows.map(rowToWorkflow),
    ...[...BUILTINS.values()].filter(w => !dbNames.has(w.name)),
  ]
}

export function getWorkflow(name: string): Workflow | undefined {
  const row = db.select().from(schema.workflows).where(eq(schema.workflows.name, name)).get()
  return row ? rowToWorkflow(row) : BUILTINS.get(name)
}
