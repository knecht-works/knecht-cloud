// Builds the marketing DB for the screenshots on knecht.works from the dev DB:
// its setup (GitHub App, integrations, members) plus fixed workflows, triggers,
// sessions and runs. Runs inside the dev VM, see the marketing-shots skill.
//
//   node scripts/seed-marketing.mjs           build marketing.db with the real repo names
//   node scripts/seed-marketing.mjs --rename  switch marketing.db to PROJECT_NAMES
//
// Live boots clone by the repo's full name, so rename only after them.
import { chmodSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PROJECT_NAMES = {
  1: 'ikeaa/assembly-instructions',
  2: 'goggle/search-homepage',
  3: 'spotifly/wrapped',
  4: 'tesloo/configurator',
  6: 'nasaa/mars-landing-page',
  7: 'mikrosoft/clippy-revival',
  8: 'amazoon/checkout',
  11: 'netflux/blog',
}
const KEEP_MCP_SERVERS = [13, 15, 16]
// Above every dev session id: a live session's checkout and ddev project are keyed by it.
const SESSION_ID_START = 9000
const LIVE_SESSION_ID_START = 9500

const dataDir = process.env.KNECHT_DATA_DIR ?? join(process.env.HOME, '.knecht-dev/.data')
const src = process.env.KNECHT_DB_PATH ?? join(dataDir, 'knecht.db')
const dest = join(dataDir, 'marketing.db')

if (process.argv.includes('--rename')) {
  const db = new DatabaseSync(dest)
  const rename = db.prepare('update projects set owner = ?, name = ?, full_name = ? where id = ?')
  for (const [id, fullName] of Object.entries(PROJECT_NAMES)) {
    const [owner, name] = fullName.split('/')
    rename.run(owner, name, fullName, Number(id))
  }
  console.log(`Renamed the projects in ${dest}`)
  process.exit(0)
}

for (const suffix of ['', '-wal', '-shm']) rmSync(dest + suffix, { force: true })
new DatabaseSync(src, { readOnly: true }).exec(`vacuum into '${dest}'`)
// The dev container runs as another user that shares only the group.
chmodSync(dest, 0o664)
const db = new DatabaseSync(dest)
const fixture = JSON.parse(readFileSync(new URL('./seed-marketing.fixture.json', import.meta.url), 'utf8'))

const now = Math.floor(Date.now() / 1000)
const hoursAgo = h => now - Math.round(h * 3600)
const projectIds = Object.keys(PROJECT_NAMES).join(',')

db.exec(`
  delete from projects where id not in (${projectIds});
  delete from project_links where project_id not in (${projectIds});
  delete from project_ai_settings where project_id not in (${projectIds});
  delete from mcp_servers where id not in (${KEEP_MCP_SERVERS.join(',')});
  delete from mcp_server_project_off;
  delete from sessions; delete from session_objects; delete from runs; delete from run_steps;
  delete from followups; delete from agent_items; delete from tool_calls;
  delete from workflows; delete from triggers; delete from invites; delete from password_resets;
  insert or replace into project_links (project_id, integration, external_key, external_name, created_at) values (1, 'jira', 'KAN', 'Knecht Cloud', unixepoch());
  update settings set workflows_seeded = 1;
  update integration_connections set last_rejected_at = null, last_rejected_reason = null;
  delete from sqlite_sequence where name in ('sessions', 'runs', 'run_steps', 'session_objects', 'followups', 'agent_items');
  insert into sqlite_sequence (name, seq) values ('sessions', ${SESSION_ID_START});
`)

const insertWorkflow = db.prepare(`insert into workflows (id, name, description, steps, enabled, created_at, updated_at, published_at, replies_enabled)
  values (?, ?, ?, ?, 1, ?, ?, ?, ?)`)
for (const w of fixture.workflows) {
  insertWorkflow.run(w.id, w.name, w.description, JSON.stringify(w.steps), hoursAgo(24 * 30), hoursAgo(24 * 3), hoursAgo(24 * 3), w.repliesEnabled ? 1 : 0)
}
const workflows = new Map(fixture.workflows.map(w => [w.id, w]))

const insertTrigger = db.prepare(`insert into triggers (id, source, workflow_id, project_ids, config, active, created_at, updated_at, integration, branch)
  values (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
for (const t of fixture.triggers) {
  insertTrigger.run(t.id, t.source, t.workflowId, JSON.stringify(t.projectIds), JSON.stringify(t.config), hoursAgo(24 * 30), hoursAgo(24 * 30), t.integration, t.branch)
}

const insertSession = db.prepare(`insert into sessions (project_id, status, branch, env_state, created_at, closed_at, tier, base_branch, wake_on_visit)
  values (?, ?, ?, ?, ?, ?, ?, 'main', 0)`)
const insertObject = db.prepare(`insert into session_objects (session_id, project_id, integration, kind, key, url, title, status, created_at)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
const insertRun = db.prepare(`insert into runs (project_id, session_id, workflow, workflow_id, title, status, kind, trigger, object_id, branch, pr_url, steps, inputs, started_at, finished_at, created_at)
  values (?, ?, ?, ?, ?, ?, 'workflow', ?, ?, ?, ?, ?, '{}', ?, ?, ?)`)
const insertStep = db.prepare(`insert into run_steps (run_id, step_index, step_id, type, status, outputs, error, started_at, finished_at)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?)`)

const TRACKER_URLS = {
  jira: key => `https://knecht-works.atlassian.net/browse/${key}`,
  plane: key => `https://app.plane.so/knecht-works/browse/${key}/`,
  linear: key => `https://linear.app/knecht-works/issue/${key}`,
}

function seedSession(s) {
  const project = db.prepare('select full_name, ddev_env from projects where id = ?').get(s.project)
  const started = hoursAgo(s.hoursAgo)
  const closed = s.closed ? started + 3600 : null
  const tier = s.tier ?? (project.ddev_env ? 'preview' : 'code')
  const sessionId = Number(insertSession.run(s.project, closed ? 'closed' : 'open', s.branch ?? 'main', closed ? 'down' : s.envState ?? 'stopped', started, closed, tier).lastInsertRowid)

  let objectId = null
  let prUrl = null
  for (const o of s.objects ?? []) {
    const url = o.integration === 'github'
      ? `https://github.com/${project.full_name}/${o.kind === 'pull_request' ? 'pull' : 'issues'}/${o.key}`
      : TRACKER_URLS[o.integration](o.key)
    const id = Number(insertObject.run(sessionId, s.project, o.integration, o.kind, o.key, url, o.title, closed ? 'closed' : 'open', started).lastInsertRowid)
    objectId ??= id
    if (o.kind === 'pull_request') prUrl = url
  }

  const workflow = workflows.get(s.workflow)
  const finished = started + (s.minutes ?? 4) * 60
  const runId = Number(insertRun.run(
    s.project, sessionId, workflow.name, workflow.id, s.title ?? null, s.status ?? 'success', s.trigger ?? 'manual', objectId,
    s.branch ?? 'main', prUrl, JSON.stringify(workflow.steps), started, finished, started,
  ).lastInsertRowid)

  const stepTime = Math.floor((finished - started) / workflow.steps.length)
  workflow.steps.forEach((step, i) => {
    const failed = s.status === 'failed' && i === workflow.steps.length - 1
    const outputs = step.type === 'ddev-start'
      ? { url: `http://${sessionId}.preview.lvh.me:3333` }
      : step.type === 'ai' && s.summary && !failed ? { text: s.summary } : {}
    insertStep.run(runId, i, step.id, step.type, failed ? 'failed' : 'success', JSON.stringify(outputs), failed ? s.error : null,
      started + i * stepTime, started + (i + 1) * stepTime)
  })
  return { sessionId, runId, started }
}

const SESSIONS = [
  // Booted live for the shots: its workflow has no boot step, so it starts as a code session.
  { project: 2, hoursAgo: 2, workflow: 15, trigger: 'jira', minutes: 6, branch: 'CC-128-doodle-safari', tier: 'code', envState: 'down', live: true, objects: [
    { integration: 'jira', kind: 'issue', key: 'CC-128', title: 'Anniversary doodle does not load in Safari' },
    { integration: 'github', kind: 'pull_request', key: '84', title: 'CC-128: Serve the doodle as WebP with a PNG fallback' },
  ], summary: 'Safari 16 cannot decode the AVIF doodle. I added a WebP source with a PNG fallback and opened a pull request.' },
  { project: 2, hoursAgo: 4, workflow: 23, trigger: 'linear', minutes: 3, objects: [
    { integration: 'linear', kind: 'issue', key: 'CRA-41', title: 'Bring back the I\'m Feeling Lucky button' },
  ], summary: 'I wrote an implementation plan as a comment: one button next to Search that opens the first result.' },
  { project: 2, hoursAgo: 6, workflow: 19, trigger: 'plane', minutes: 5, branch: 'CRAFT-19-search-focus', objects: [
    { integration: 'plane', kind: 'issue', key: 'CRAFT-19', title: 'Search box loses focus after pressing Escape' },
  ], summary: 'The Escape handler closed the suggestions and blurred the input. It now only closes the suggestions.' },
  { project: 2, hoursAgo: 9, workflow: 83, trigger: 'github', minutes: 2, branch: 'chore/update-craft', objects: [
    { integration: 'github', kind: 'pull_request', key: '82', title: 'Update Craft CMS to 5.12' },
  ], summary: 'The update only touches composer.lock. I found nothing to change.' },
  { project: 2, hoursAgo: 12, workflow: 10, trigger: 'github', minutes: 4, branch: 'fix/suggestions-language', objects: [
    { integration: 'github', kind: 'issue', key: '79', title: 'Search suggestions appear in the wrong language' },
  ], summary: 'The suggestions ignored the Accept-Language header. They now follow the language of the page.' },
  { project: 11, hoursAgo: 3, workflow: 10, trigger: 'github', minutes: 7, objects: [
    { integration: 'github', kind: 'issue', key: '31', title: '"Are you still reading?" modal opens after every paragraph' },
  ], summary: 'The modal timer reset on every scroll event. It now opens once per visit.' },
  { project: 8, hoursAgo: 5, workflow: 10, trigger: 'github', status: 'failed', minutes: 9, objects: [
    { integration: 'github', kind: 'issue', key: '17', title: 'One-click checkout needs two clicks' },
  ], error: 'The agent stopped: the payment sandbox rejected every request with 401.' },
  { project: 7, hoursAgo: 7, workflow: 83, trigger: 'github', minutes: 2, branch: 'feat/clippy-404', objects: [
    { integration: 'github', kind: 'pull_request', key: '12', title: 'Clippy offers help on the 404 page' },
  ], summary: 'Looks good. One note: the speech bubble covers the search field on small screens.' },
  { project: 6, hoursAgo: 11, workflow: 8, trigger: 'github', minutes: 3, objects: [
    { integration: 'github', kind: 'issue', key: '8', title: 'Countdown shows negative days after landing' },
  ], summary: 'Labeled as bug: the countdown has no state for a date in the past.' },
  { project: 3, hoursAgo: 13, workflow: 10, trigger: 'github', minutes: 5, objects: [
    { integration: 'github', kind: 'issue', key: '23', title: 'Wrapped shows 2019 instead of 2026' },
  ], summary: 'The year came from a hardcoded constant. It now uses the current year.' },
  { project: 2, hoursAgo: 26, workflow: 3, title: 'Add a dark mode toggle', minutes: 1, conversation: true },
  { project: 4, hoursAgo: 20, workflow: 12, trigger: 'github', minutes: 6, closed: true, objects: [
    { integration: 'github', kind: 'issue', key: '14', title: 'Steering yoke option missing on mobile' },
  ] },
  { project: 1, hoursAgo: 30, workflow: 8, trigger: 'github', minutes: 2, closed: true, objects: [
    { integration: 'github', kind: 'issue', key: '6', title: 'Step 7 shows a screw that is not in the box' },
  ] },
]

const DONE_TITLES = [
  'Update dependencies', 'Fix broken link in the footer', 'Improve the Lighthouse score on mobile',
  'Add alt texts to the hero images', 'Cookie banner covers the menu on small phones', 'Translate the newsletter form',
  'Speed up the search results page', 'Remove unused CSS', 'Fix a typo on the about page', 'Add Open Graph images',
  'Contact form sends two emails', 'Sitemap misses the blog posts', 'Upgrade PHP to 8.4', 'Lazy-load images below the fold',
  'Empty search returns a 500', 'Add a skip-to-content link',
]
const DONE_PER_PROJECT = { 2: 40, 11: 14, 8: 9, 7: 18, 6: 7, 4: 11, 3: 15, 1: 4 }
const DONE_TRACKERS = { 2: [['jira', 'CC-'], ['plane', 'CRAFT-'], ['linear', 'CRA-'], ['github', '']] }
const DONE_WORKFLOWS = { github: [10, 8, 83], jira: [14, 15], plane: [18, 19], linear: [21, 23] }
let seed = 7
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
let n = 0
for (const [project, count] of Object.entries(DONE_PER_PROJECT)) {
  for (let i = 0; i < count; i++) {
    n++
    const trackers = DONE_TRACKERS[project] ?? [['github', '']]
    const [integration, prefix] = trackers[i % trackers.length]
    const flow = DONE_WORKFLOWS[integration][i % DONE_WORKFLOWS[integration].length]
    SESSIONS.push({
      project: Number(project), hoursAgo: 14 + random() ** 1.6 * 13 * 24, workflow: flow, trigger: integration, closed: true,
      minutes: 2 + Math.floor(random() * 7), status: random() < 0.1 ? 'failed' : 'success', error: 'The preview did not answer within 5 minutes.',
      objects: [{ integration, kind: flow === 83 ? 'pull_request' : 'issue', key: `${prefix}${100 - i}`, title: DONE_TITLES[n % DONE_TITLES.length] }],
    })
  }
}

SESSIONS.sort((a, b) => b.hoursAgo - a.hoursAgo)
const { prompt, items } = fixture.conversation
const insertFollowup = db.prepare(`insert into followups (run_id, session_id, prompt, requested_by, status, started_at, finished_at, created_at)
  values (?, ?, ?, 'samuelreichor', 'success', ?, ?, ?)`)
const insertItem = db.prepare(`insert into agent_items (session_id, followup_id, seq, type, text, kind, status, input, output, diff, locations, cost, tokens, created_at)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
const json = v => v == null ? null : JSON.stringify(v)

db.exec('begin')
for (const s of SESSIONS) {
  const { sessionId, runId, started } = seedSession(s)
  if (s.live) console.log(`Live session: ${sessionId}`)
  if (!s.conversation) continue
  const asked = started + 120
  const followupId = Number(insertFollowup.run(runId, sessionId, prompt, asked, asked + 30, asked).lastInsertRowid)
  for (const it of items) {
    insertItem.run(sessionId, followupId, it.seq, it.type, it.text, it.kind, it.status, json(it.input), it.output, it.diff, json(it.locations), it.cost, json(it.tokens), asked + it.seq * 4)
  }
  console.log(`Dark mode conversation: session ${sessionId}`)
}
db.exec(`update sqlite_sequence set seq = ${LIVE_SESSION_ID_START - 1} where name = 'sessions'`)
db.exec('commit')

console.log(`Seeded ${dest}: ${SESSIONS.length} sessions, setup from ${src}. Live boots start at session ${LIVE_SESSION_ID_START}.`)
