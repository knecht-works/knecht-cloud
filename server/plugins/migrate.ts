import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from '../db'
import { runDataMigrations } from '../db/data-migrations'

// SQL first: it creates the data_migrations table the JS migrations record into.
export default defineNitroPlugin(() => {
  migrate(db, { migrationsFolder: 'server/db/migrations' })
  runDataMigrations()
})
