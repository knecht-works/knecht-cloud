import { eq } from 'drizzle-orm'
import { db, schema } from './index'
import { stripLegacyModelPrefix } from '../../shared/utils/ai'
import { deriveStepId, ensureStepIds, flattenSteps, renameStepReferences } from '../../shared/utils/workflow'

// One-time data migrations: JS transformations the SQL migration files can't
// express (drizzle-kit only generates SQL). Same contract as the schema
// migrations: each entry runs exactly once per instance, tracked by name in
// `data_migrations`, applied in list order right after the SQL migrations
// (server/plugins/migrate.ts), so updates never depend on version order.
// Append-only: never rename or remove an entry once released.
const MIGRATIONS: { name: string, run: () => void }[] = [
  { name: '0001_step_id_slugs', run: stepIdSlugs },
  { name: '0002_bare_ai_step_models', run: bareAiStepModels },
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

// Workflows saved before ids were label-derived carry sequential `s<n>` ids.
// Rewrite them to the current standard (label/type slug), including the
// workflow's own {{ steps.<id>… }} references. Runs pinned before this keep
// their old ids: they're historical records, not definitions.
// Model names lost their provider prefix (docs/adr/0003): ai-step overrides
// saved as 'anthropic/claude-sonnet-4-5' become 'claude-sonnet-4-5'. The
// settings row is handled in SQL (0020); runs pinned before this keep their
// prefixed snapshots (historical records, the runtime strips defensively).
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
