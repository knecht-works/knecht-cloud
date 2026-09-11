import '../helpers/test-env'

const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
const { sql } = await import('drizzle-orm')
const { db } = await import('../../server/db')
migrate(db, { migrationsFolder: 'server/db/migrations' })

// Session ids far away from run ids: code that keys an env by the wrong id
// must fail loudly instead of passing by coincidence.
db.run(sql`INSERT INTO sqlite_sequence (name, seq) VALUES ('sessions', 1000)`)
