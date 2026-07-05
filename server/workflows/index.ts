import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { ensureStepIds } from '../../shared/utils/workflow'
import { getSettings, updateSettings } from '../utils/settings'
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

// The bundled starter templates, parsed + validated once at module load (a bad
// definition fails fast on boot). They're seeded into the table on first boot
// (seedWorkflows) and thereafter owned by the user — there's no runtime fallback.
const STARTERS: Workflow[] = [BOOT_AND_PREVIEW, DEMO_PR].map(parseWorkflow)

function rowToWorkflow(row: typeof schema.workflows.$inferSelect): Workflow {
  // Pre-id rows get ids backfilled on read (deterministic, so the engine and
  // the API agree without persisting); saves from the builder persist them.
  return { name: row.name, description: row.description, steps: ensureStepIds(row.steps) }
}

export function listWorkflows(): Workflow[] {
  return db.select().from(schema.workflows).all().map(rowToWorkflow)
}

export function getWorkflow(name: string): Workflow | undefined {
  const row = db.select().from(schema.workflows).where(eq(schema.workflows.name, name)).get()
  return row ? rowToWorkflow(row) : undefined
}

// Whether the workflow's automation is on. A missing row (already deleted)
// counts as off — nothing to fire.
export function isWorkflowEnabled(name: string): boolean {
  const row = db.select({ enabled: schema.workflows.enabled }).from(schema.workflows).where(eq(schema.workflows.name, name)).get()
  return row ? row.enabled : false
}

// Insert the starter templates on first boot only (tracked by the settings
// flag), skipping any name that already exists. After that, workflows are fully
// user-owned — deletions and renames stick, so we never re-seed.
export function seedWorkflows(): void {
  if (getSettings().workflowsSeeded) return
  const existing = new Set(db.select({ name: schema.workflows.name }).from(schema.workflows).all().map(r => r.name))
  for (const wf of STARTERS) {
    if (!existing.has(wf.name)) {
      db.insert(schema.workflows).values({ name: wf.name, description: wf.description, steps: wf.steps }).run()
    }
  }
  updateSettings({ workflowsSeeded: true })
}
