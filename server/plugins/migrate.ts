import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from '../db'

// Apply pending migrations on boot, so a fresh instance self-initializes its
// schema. Dev resolves the folder from cwd; the container build bundles it.
export default defineNitroPlugin(() => {
  migrate(db, { migrationsFolder: 'server/db/migrations' })
})
