// Seed fake demo projects (plus a few finished runs) into the local dev DB so
// the projects dashboard has something to show. The repos do not exist on
// GitHub: framework/ddevEnv/favicon are pre-filled so the GitHub backfill
// never fires, but starting a real run against them will fail at checkout.
//
// Usage: npm run db:seed:demo  (idempotent, keyed on github_id; re-running
// skips projects that are already there)
import Database from 'better-sqlite3'

const dbPath = process.env.KNECHT_DB_PATH || '.data/knecht.db'
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

const ddevEnv = (phpVersion, nodeVersion = '20') => JSON.stringify({
  webserver: 'nginx-fpm',
  phpVersion,
  dbType: 'mariadb',
  dbVersion: '10.11',
  nodeVersion,
  packageManager: 'npm',
})

// Fake github_ids far above any real installation's repos, so a later real
// connect can never collide with a seeded row.
const projects = [
  { githubId: 990000001, owner: 'stadtwerke-mch', name: 'typo3-portal', defaultBranch: 'main', framework: 'typo3', frameworkVersion: '13.4', ddevEnv: ddevEnv('8.3') },
  { githubId: 990000002, owner: 'klinikum-nord', name: 'wp-relaunch', defaultBranch: 'develop', framework: 'wordpress', frameworkVersion: '6.5', ddevEnv: ddevEnv('8.2') },
  { githubId: 990000003, owner: 'acme-intra', name: 'craft-intranet', defaultBranch: 'main', framework: 'craftcms', frameworkVersion: '4.10', ddevEnv: ddevEnv('8.2') },
  { githubId: 990000004, owner: 'handelshaus', name: 'shopware-b2b', defaultBranch: 'main', framework: 'shopware6', frameworkVersion: '6.6', ddevEnv: ddevEnv('8.3', '22') },
  { githubId: 990000005, owner: 'kanzlei-roth', name: 'typo3-web', defaultBranch: 'staging', framework: 'typo3', frameworkVersion: '12.4', ddevEnv: ddevEnv('8.1') },
  { githubId: 990000006, owner: 'verein-gruen', name: 'wp-events', defaultBranch: 'main', framework: 'wordpress', frameworkVersion: '6.4', ddevEnv: ddevEnv('8.2') },
]

// Finished runs per seeded project (keyed by owner), so the cards show a
// status and a duration instead of "No runs yet". Only success/failed: a
// seeded 'queued' run would get claimed by the dispatcher and actually
// executed against the nonexistent repo.
const runsByOwner = {
  'stadtwerke-mch': [
    { workflow: 'boot-and-preview', status: 'success', durationS: 38, agoMin: 45 },
    { workflow: 'demo-pr', status: 'success', durationS: 41, agoMin: 60 * 26 },
  ],
  'klinikum-nord': [
    { workflow: 'boot-and-preview', status: 'success', durationS: 29, agoMin: 60 * 3 },
  ],
  'acme-intra': [
    { workflow: 'boot-and-preview', status: 'success', durationS: 52, agoMin: 60 * 30 },
  ],
  'handelshaus': [
    { workflow: 'demo-pr', status: 'success', durationS: 47, agoMin: 60 * 5, prUrl: 'https://github.com/handelshaus/shopware-b2b/pull/128' },
  ],
  'kanzlei-roth': [
    { workflow: 'boot-and-preview', status: 'failed', durationS: 12, agoMin: 90 },
  ],
  'verein-gruen': [
    { workflow: 'boot-and-preview', status: 'success', durationS: 24, agoMin: 60 * 49 },
  ],
}

const insertProject = db.prepare(`
  INSERT OR IGNORE INTO projects
    (github_id, owner, name, full_name, default_branch, private, clone_url,
     framework, framework_version, ddev_env, favicon)
  VALUES
    (@githubId, @owner, @name, @fullName, @defaultBranch, 1, @cloneUrl,
     @framework, @frameworkVersion, @ddevEnv, '')
`)

const insertRun = db.prepare(`
  INSERT INTO runs
    (project_id, workflow, workflow_id, status, trigger, branch, pr_url, started_at, finished_at, created_at)
  VALUES
    (@projectId, @workflow, (SELECT id FROM workflows WHERE name = @workflow),
     @status, 'manual', @branch, @prUrl, @startedAt, @finishedAt, @startedAt)
`)

const now = Math.floor(Date.now() / 1000)
let seeded = 0

for (const p of projects) {
  const result = insertProject.run({
    ...p,
    fullName: `${p.owner}/${p.name}`,
    cloneUrl: `https://github.com/${p.owner}/${p.name}.git`,
  })
  if (result.changes === 0) {
    console.log(`skip  ${p.owner}/${p.name} (already seeded)`)
    continue
  }
  const projectId = result.lastInsertRowid
  for (const r of runsByOwner[p.owner] ?? []) {
    const startedAt = now - r.agoMin * 60
    insertRun.run({
      projectId,
      workflow: r.workflow,
      status: r.status,
      branch: p.defaultBranch,
      prUrl: r.prUrl ?? null,
      startedAt,
      finishedAt: startedAt + r.durationS,
    })
  }
  seeded++
  console.log(`seed  ${p.owner}/${p.name}`)
}

console.log(`${seeded} demo project(s) seeded into ${dbPath}`)
