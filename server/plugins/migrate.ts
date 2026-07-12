import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from '../db'
import { runDataMigrations } from '../db/data-migrations'

// Apply pending migrations on boot, so a fresh instance self-initializes its
// schema. Dev resolves the folder from cwd; the container build bundles it.
// SQL first (schema, including the data_migrations bookkeeping table), then
// the one-time JS data migrations that transform stored rows.
export default defineNitroPlugin(() => {
  migrate(db, { migrationsFolder: 'server/db/migrations' })
  runDataMigrations()
})
