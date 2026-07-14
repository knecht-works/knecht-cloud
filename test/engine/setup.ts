import '../helpers/test-env'

// Engine tests exercise the real runner against the real schema: migrate the
// per-process temp DB (test-env.ts set the path) exactly like boot does
// (server/plugins/migrate.ts).
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
const { db } = await import('../../server/db')
migrate(db, { migrationsFolder: 'server/db/migrations' })
