import '../helpers/test-env'

// Engine tests exercise the real runner against the real schema: migrate the
// per-process temp DB (test-env.ts set the path) exactly like boot does
// (server/plugins/migrate.ts).
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
const { sql } = await import('drizzle-orm')
const { db } = await import('../../server/db')
migrate(db, { migrationsFolder: 'server/db/migrations' })

// Force session ids far away from run ids: in production they diverge (a
// session outlives its first run), and code that keys an env by the wrong id
// must fail loudly in tests instead of passing by coincidence.
db.run(sql`INSERT INTO sqlite_sequence (name, seq) VALUES ('sessions', 1000)`)
