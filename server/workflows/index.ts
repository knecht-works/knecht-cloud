import { eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { ensureStepIds } from '../../shared/utils/workflow'
import { getSettings, updateSettings } from '../utils/settings'
import { parseWorkflow, type Workflow } from './schema'

// Embedded, not read from disk: the bundled Nitro output has no source files.

const BOOT_AND_PREVIEW = `
version: 1
name: boot-and-preview
description: Boot the project, install dependencies, import the DB, and preview it.
steps:
  - ddev-start:
      commands: |
        if [ -f composer.json ]; then ddev composer install; fi
        if [ -f package.json ]; then ddev npm install && ddev npm run build --if-present; fi
`

const DEMO_PR = `
version: 1
name: demo-pr
description: Make a small change and open a PR to demonstrate the git blocks and variable passing.
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
        Automated demo change by Knecht, run {{ run.id }} on {{ project.name }}.
`

const STARTERS: Workflow[] = [BOOT_AND_PREVIEW, DEMO_PR].map(parseWorkflow)

function rowToWorkflow(row: typeof schema.workflows.$inferSelect): Workflow {
  return { name: row.name, description: row.description, steps: ensureStepIds(row.steps) }
}

export function listWorkflows(): Workflow[] {
  return db.select().from(schema.workflows).all().map(rowToWorkflow)
}

export function getWorkflow(id: number): Workflow | undefined {
  const row = db.select().from(schema.workflows).where(eq(schema.workflows.id, id)).get()
  return row ? rowToWorkflow(row) : undefined
}

export function seedWorkflows(): void {
  if (getSettings().workflowsSeeded) return
  const existing = new Set(db.select({ name: schema.workflows.name }).from(schema.workflows).all().map(r => r.name))
  for (const wf of STARTERS) {
    if (!existing.has(wf.name)) {
      db.insert(schema.workflows).values({ name: wf.name, description: wf.description, steps: wf.steps, publishedAt: new Date() }).run()
    }
  }
  updateSettings({ workflowsSeeded: true })
}
