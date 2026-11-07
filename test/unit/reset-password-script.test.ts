import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'

function run(dbPath: string, username: string) {
  return execFileSync('node', ['scripts/reset-password.mjs', username], {
    env: { ...process.env, KNECHT_DB_PATH: dbPath, KNECHT_BASE_URL: 'https://knecht.example/' },
    encoding: 'utf8',
    stdio: 'pipe',
  })
}

describe('scripts/reset-password.mjs', () => {
  it('stores a reset link the app accepts and prints it', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'knecht-reset-')), 'knecht.db')
    const sqlite = new Database(dbPath)
    migrate(drizzle(sqlite), { migrationsFolder: 'server/db/migrations' })
    sqlite.exec(`INSERT INTO members (login, is_owner) VALUES ('owner', 1)`)

    const out = run(dbPath, 'Owner')
    const token = /https:\/\/knecht\.example\/reset\/(\S+)/.exec(out)?.[1]
    expect(token).toBeTruthy()
    const row = sqlite.prepare('SELECT member_id, token_hash, expires_at FROM password_resets').get() as { member_id: number, token_hash: string, expires_at: number }
    expect(row.member_id).toBe(1)
    expect(row.token_hash).toBe(createHash('sha256').update(token!).digest('hex'))
    expect(row.expires_at - Date.now() / 1000).toBeGreaterThan(23 * 60 * 60)

    run(dbPath, 'owner')
    expect(sqlite.prepare('SELECT count(*) AS n FROM password_resets').get()).toEqual({ n: 1 })
    expect(() => run(dbPath, 'nobody')).toThrow()
  })
})
