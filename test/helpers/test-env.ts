import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Point everything file-backed at a per-process temp dir BEFORE any test file
// imports server modules (setup files load first; vitest runs each test file
// in its own forked process, so this also isolates test files from each
// other). server/db opens the SQLite at import time, so without this a test
// would create/open the developer's .data/knecht.db.
const dir = mkdtempSync(join(tmpdir(), 'knecht-test-'))
process.env.KNECHT_DB_PATH = join(dir, 'knecht.db')
process.env.KNECHT_DATA_DIR = join(dir, 'data')
process.env.KNECHT_PROJECTS = join(dir, 'projects')
process.env.KNECHT_BASE_URL = 'http://knecht.test'
process.env.NUXT_SESSION_PASSWORD = 'knecht-test-password-0123456789abcdef'
