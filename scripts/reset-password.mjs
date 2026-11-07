// Prints a password reset link for a member, for when no other owner can create one.
// Usage: docker compose exec knecht node scripts/reset-password.mjs <username>
// Without a username it lists the members, for an owner who forgot theirs.
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// Same token, hash and lifetime as the links owners create (server/utils/link-token.ts,
// server/stores/password-resets.ts), so the app's reset page accepts it.
const RESET_TTL_S = 24 * 60 * 60

// The image ships only the Nitro bundle, which carries its own copy of better-sqlite3.
function loadSqlite() {
  for (const from of [import.meta.url, resolve('.output/server/index.mjs')]) {
    try {
      return createRequire(from)('better-sqlite3')
    }
    catch {
      // Try the next location.
    }
  }
  throw new Error('better-sqlite3 not found: run this from the app directory')
}

const Database = loadSqlite()
const dbPath = process.env.KNECHT_DB_PATH || '.data/knecht.db'
let db
try {
  db = new Database(dbPath, { fileMustExist: true })
}
catch {
  console.error(`No database at ${resolve(dbPath)}: run this from the app directory or set KNECHT_DB_PATH.`)
  process.exit(1)
}
const username = process.argv[2]?.trim().toLowerCase()
if (!username) {
  const members = db.prepare('SELECT login, is_owner FROM members ORDER BY is_owner DESC, login').all()
  console.error('Usage: node scripts/reset-password.mjs <username>')
  console.error(`Members: ${members.map(m => m.is_owner ? `${m.login} (owner)` : m.login).join(', ') || 'none'}`)
  process.exit(1)
}

const member = db.prepare('SELECT id FROM members WHERE login = ?').get(username)
if (!member) {
  console.error(`No member named ${username}.`)
  process.exit(1)
}

const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('hex')
const expiresAt = Math.floor(Date.now() / 1000) + RESET_TTL_S
db.transaction(() => {
  db.prepare('DELETE FROM password_resets WHERE member_id = ?').run(member.id)
  db.prepare('INSERT INTO password_resets (member_id, token_hash, expires_at) VALUES (?, ?, ?)').run(member.id, tokenHash, expiresAt)
})()

const origin = process.env.KNECHT_BASE_URL?.replace(/\/+$/, '')
  || (process.env.KNECHT_BASE_DOMAIN ? `https://${process.env.KNECHT_BASE_DOMAIN}` : '')
console.log(`Reset link for ${username}, valid for 24 hours:\n${origin}/reset/${token}`)
