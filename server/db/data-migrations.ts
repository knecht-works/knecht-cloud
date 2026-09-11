import { and, eq } from 'drizzle-orm'
import { db, schema } from './index'
import { stripLegacyModelPrefix } from '../../shared/utils/ai'
import { deriveStepId, ensureStepIds, flattenSteps, renameStepReferences } from '../../shared/utils/workflow'

// Append-only: entries are tracked by name, never rename or remove a released one.
const MIGRATIONS: { name: string, run: () => void }[] = [
  { name: '0001_step_id_slugs', run: stepIdSlugs },
  { name: '0002_bare_ai_step_models', run: bareAiStepModels },
  { name: '0003_cancelled_step_rows', run: cancelledStepRows },
]

export function runDataMigrations(): void {
  const applied = new Set(
    db.select({ name: schema.dataMigrations.name }).from(schema.dataMigrations).all().map(r => r.name),
  )
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue
    migration.run()
    db.insert(schema.dataMigrations).values({ name: migration.name }).run()
  }
}

function bareAiStepModels(): void {
  for (const row of db.select().from(schema.workflows).all()) {
    let changed = false
    for (const step of flattenSteps(row.steps)) {
      if (step.type !== 'ai' || !step.model) continue
      const bare = stripLegacyModelPrefix(step.model)
      if (bare === step.model) continue
      step.model = bare
      changed = true
    }
    if (changed) {
      db.update(schema.workflows).set({ steps: row.steps }).where(eq(schema.workflows.name, row.name)).run()
    }
  }
}

function stepIdSlugs(): void {
  for (const row of db.select().from(schema.workflows).all()) {
    const steps = ensureStepIds(row.steps)
    const flat = flattenSteps(steps)
    const taken = new Set(flat.map(s => s.id!))
    let changed = steps !== row.steps
    for (const step of flat) {
      if (!/^s\d+$/.test(step.id!)) continue
      taken.delete(step.id!)
      const id = deriveStepId(step.label || step.type, taken)
      renameStepReferences(steps, step.id!, id)
      step.id = id
      taken.add(id)
      changed = true
    }
    if (changed) {
      db.update(schema.workflows).set({ steps }).where(eq(schema.workflows.name, row.name)).run()
    }
  }
}

// Before the cancelled step status existed, an aborted step was stored as failed with this error text.
function cancelledStepRows(): void {
  db.update(schema.runSteps)
    .set({ status: 'cancelled', error: null })
    .where(and(eq(schema.runSteps.status, 'failed'), eq(schema.runSteps.error, 'Cancelled')))
    .run()
}
