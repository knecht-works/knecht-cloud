import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { ENV_STATES } from '../../shared/utils/run'
import type { EnvVar } from '../../shared/utils/env'
import type { Step } from '../../shared/utils/workflow'

// The DDEV environment spec, read from the repo's `.ddev/config.yaml` (+ the
// `packageManager` field of its `package.json`). Shown read-only on the project
// detail page. Null until resolved; resolved alongside `framework`.
export interface DdevEnv {
  webserver: string | null // e.g. 'nginx-fpm'
  phpVersion: string | null // e.g. '8.3'
  dbType: string | null // e.g. 'mariadb'
  dbVersion: string | null // e.g. '10.11'
  nodeVersion: string | null // e.g. '20'
  packageManager: string | null // e.g. 'pnpm@9.1.0'
}

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),

  // GitHub repo identity (from the connected repo)
  githubId: integer('github_id').notNull().unique(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  fullName: text('full_name').notNull(),
  defaultBranch: text('default_branch').notNull(),
  private: integer('private', { mode: 'boolean' }).notNull().default(false),
  cloneUrl: text('clone_url').notNull(),

  // The DDEV project type read from the repo's `.ddev/config.yaml` `type:` field
  // (e.g. 'typo3', 'wordpress', 'craftcms'). Identifies the framework. Null until
  // resolved; backfilled lazily from GitHub when a project is loaded.
  framework: text('framework'),
  // The framework's major.minor version (e.g. '13.4'), read from the matching
  // package in the repo's composer.lock. Null when not composer-managed or
  // unreadable. Resolved alongside `framework`.
  frameworkVersion: text('framework_version'),
  // The DDEV environment spec (web/php/db/node/package manager). Null until
  // resolved from the repo; resolved alongside `framework`.
  ddevEnv: text('ddev_env', { mode: 'json' }).$type<DdevEnv>(),

  // Per-project config (maintained on the project detail page — increment 2)
  envVars: text('env_vars', { mode: 'json' })
    .$type<EnvVar[]>()
    .notNull()
    .default(sql`'[]'`),
  dbDumpPath: text('db_dump_path'),
  // Whether the current dump has already been imported into the ddev volume.
  // The import is one-time (projects.md §6); reset to false when a new dump is
  // uploaded so it re-imports on the next boot.
  dbImported: integer('db_imported', { mode: 'boolean' }).notNull().default(false),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert

// A single execution of a workflow against one project. The in-process serial
// runner (server/daemon/runner.ts) owns the row: it flips status and appends to
// `log` as blocks run. The UI polls the row for live status/log.
// On a daemon restart, any run left 'running' is reset to 'failed' (no resume).
export const runs = sqliteTable('runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  workflow: text('workflow').notNull(),
  status: text('status', { enum: ['queued', 'running', 'success', 'failed'] })
    .notNull()
    .default('queued'),
  // What started the run: the UI's "Start workflow" button ('manual' — also a
  // manually fired trigger, same gesture) or a trigger's source. Free-form so
  // new sources don't need a schema change; the UI falls back to a generic
  // rendering for values it doesn't know. Null on runs from before this was
  // recorded.
  trigger: text('trigger'),
  // The configured trigger that fired this run (null for UI-started runs and
  // runs from before this was recorded) — links a run back to its automation.
  triggerId: integer('trigger_id')
    .references(() => triggers.id, { onDelete: 'set null' }),
  // The branch the run works on: the project's default branch at checkout,
  // replaced by the branch a `create-branch` step creates.
  branch: text('branch'),
  // The worktree's HEAD, captured when the env is archived (includes commits
  // the run itself made). Restoring an archived env checks out exactly this.
  commitSha: text('commit_sha'),
  // The pull request a `create-pr` step opened, if the run opened one.
  prUrl: text('pr_url'),
  // The step sequence pinned at execution start: the runner executes THIS
  // snapshot, never the live workflow row — editing a workflow mid-run can't
  // change a running (or queued) run, and history shows what actually ran.
  // Null on runs from before pinning existed.
  steps: text('steps', { mode: 'json' }).$type<Step[]>(),
  log: text('log').notNull().default(''),
  // The run's isolated ddev environment: 'down' (not booted / expired), 'up'
  // (running, previewable), 'stopped' (idle-stopped — volumes kept, rebootable),
  // 'archived' (sandbox + worktree deleted, but the run's DB export + worktree
  // patch are kept so it can be restored exactly — daemon/envs.ts).
  envState: text('env_state', { enum: ENV_STATES })
    .notNull()
    .default('down'),
  // ALL hostnames the run's ddev environment serves (primary first), read from
  // .ddev/config.yaml at boot — the same set the preview proxy maps to per-run
  // origins. The UI builds its preview host switcher from this list.
  previewHosts: text('preview_hosts', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  // Last time the preview was accessed; the idle-stopper stops envs that have
  // been quiet longer than the idle timeout.
  previewLastSeen: integer('preview_last_seen', { mode: 'timestamp' }),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, table => [
  // The runs list and the per-project poll both filter by project.
  index('runs_project_id_idx').on(table.projectId),
  // The dispatcher claims queued runs by status.
  index('runs_status_idx').on(table.status),
])

export type Run = typeof runs.$inferSelect
export type NewRun = typeof runs.$inferInsert

// One row per executed step of a run (workflow-engine-plan.md D4): the runner
// inserts it when the step starts and finalizes status/outputs/error when it
// ends — the step's result is durable BEFORE the next step runs. Retries update
// the same row (`attempt` counts the tries). `parentStepId`/`iteration` locate
// a row inside composite steps (if/loop), null at the top level.
export const runSteps = sqliteTable('run_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  stepId: text('step_id').notNull(),
  type: text('type').notNull(),
  status: text('status', { enum: ['running', 'success', 'failed'] })
    .notNull()
    .default('running'),
  // The step's params as rendered for execution (meta stripped).
  params: text('params', { mode: 'json' }).$type<Record<string, unknown>>(),
  // What the action returned — the values steps.<id>.<output> resolves to.
  outputs: text('outputs', { mode: 'json' }).$type<Record<string, unknown>>(),
  error: text('error'),
  attempt: integer('attempt').notNull().default(1),
  // This step's slice of the run log (the run's `log` stays the full stream).
  log: text('log').notNull().default(''),
  parentStepId: text('parent_step_id'),
  iteration: integer('iteration'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
}, table => [
  index('run_steps_run_id_idx').on(table.runId),
])

// Workflows. Every workflow is a row here, including the bundled starter
// templates (server/workflows/index.ts), which are seeded once on first boot
// and thereafter owned by the user — freely renamed, edited or deleted. Steps
// are stored in their normalized form — the same shape the runner consumes.
export const workflows = sqliteTable('workflows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  steps: text('steps', { mode: 'json' })
    .$type<Step[]>()
    .notNull()
    .default(sql`'[]'`),
  // Master switch for the workflow's automation: when false, its triggers don't
  // fire (manual "run now" / test are unaffected). Built-ins with no row are
  // enabled by default.
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type WorkflowRow = typeof workflows.$inferSelect
export type NewWorkflowRow = typeof workflows.$inferInsert

// Instance-wide settings — a single row (id = 1). Holds the operator-tunable
// lifecycle limits that keep isolated run environments from piling up (each env
// consumes a docker network from a finite pool and disk for its volumes), the
// run concurrency limit, and the `ai` step's OpenRouter configuration.
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(), // singleton — always 1

  // Stop a run's env (its DB is exported for the archive, the sandbox keeps its
  // filesystem so a reboot is quick) after it has been idle — no preview
  // access — this many minutes. This is the RAM guard: each 'up' env is a full
  // nested Docker host. Defaults to a day: during active work nothing ever
  // stops, and overnight the memory comes back.
  idleStopMinutes: integer('idle_stop_minutes').notNull().default(1440),

  // Archive a 'stopped' env once untouched this many days: its sandbox +
  // worktree (the GBs) are deleted, keeping only the DB export + worktree patch
  // (MBs) so it can still be restored exactly. 0 keeps stopped envs forever.
  previewRetentionDays: integer('preview_retention_days').notNull().default(7),

  // Delete a run's archive (DB export + patch) once untouched this many days —
  // after that only re-running the workflow gets a fresh environment. 0 keeps
  // archives until the run is deleted.
  archiveRetentionDays: integer('archive_retention_days').notNull().default(30),

  // How many runs may execute at once (each boots a full sandbox — this is the
  // CPU/RAM guard). Queued runs wait; the dispatcher (server/plugins/
  // dispatcher.ts) starts them as slots free up.
  maxConcurrentRuns: integer('max_concurrent_runs').notNull().default(2),

  // The `ai` step (OpenRouter): API key — encrypted at rest (crypto.ts), never
  // returned by the API — and the default model (a step can override it).
  openrouterKeyEnc: text('openrouter_key_enc'),
  aiModel: text('ai_model').notNull().default('openrouter/auto'),

  // Whether the bundled starter workflows have been seeded into the table. Seeded
  // once on first boot; afterwards workflows are fully user-owned (deletions and
  // renames stick), so we never re-seed.
  workflowsSeeded: integer('workflows_seeded', { mode: 'boolean' }).notNull().default(false),
})

export type Settings = typeof settings.$inferSelect

// A configured trigger that starts a workflow automatically. Three sources:
// 'schedule' — a standard 5-field cron expression, fired by the in-process
// scheduler (server/plugins/scheduler.ts); 'github' — a repo webhook POSTing to
// /api/triggers/:id/webhook (needs a public URL + the generated secret set on
// GitHub, hence "needs setup"); and 'manual' — a saved "run this workflow on
// these projects" shortcut, fired from the Triggers screen. Every fire starts the
// workflow against each project in `projectIds` — one run per project.
export const triggers = sqliteTable('triggers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source', { enum: ['schedule', 'github', 'manual'] }).notNull(),
  workflow: text('workflow').notNull(),
  projectIds: text('project_ids', { mode: 'json' })
    .$type<number[]>()
    .notNull()
    .default(sql`'[]'`),

  // Schedule source: the cron expression and the next time the scheduler should
  // fire it (recomputed from `cron` after each fire, null while paused).
  cron: text('cron'),
  nextFireAt: integer('next_fire_at', { mode: 'timestamp' }),

  // GitHub source: the generated secret used to verify the HMAC signature GitHub
  // sends, and which event fires the trigger (e.g. 'push').
  webhookSecret: text('webhook_secret'),
  webhookEvent: text('webhook_event'),

  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  lastFiredAt: integer('last_fired_at', { mode: 'timestamp' }),
  firedCount: integer('fired_count').notNull().default(0),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type Trigger = typeof triggers.$inferSelect
export type NewTrigger = typeof triggers.$inferInsert

// The GitHub App that powers login (its OAuth client id/secret) and repo access
// (its app id/private key). A single row (id = 1). Created from the UI on first
// run via the GitHub App manifest flow (server/routes/setup/*), so a fresh
// instance needs no GitHub env vars — GitHub mints the app and returns all its
// credentials at once. Secrets are encrypted at rest (server/utils/crypto.ts).
export const githubApp = sqliteTable('github_app', {
  id: integer('id').primaryKey(), // singleton — always 1

  appId: text('app_id').notNull(),
  slug: text('slug'),
  htmlUrl: text('html_url'),
  clientId: text('client_id').notNull(),

  // Encrypted (AES-256-GCM). Never read these directly — go through the
  // credentials store (server/utils/github-credentials.ts), which decrypts.
  clientSecretEnc: text('client_secret_enc').notNull(),
  privateKeyEnc: text('private_key_enc').notNull(),
  webhookSecretEnc: text('webhook_secret_enc'),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type GithubAppRow = typeof githubApp.$inferSelect
export type NewGithubAppRow = typeof githubApp.$inferInsert

// The login allowlist — who may obtain a session. First-run setup claims the
// GitHub App's owner as the initial member (server/routes/setup/callback), and
// the login gate (server/routes/auth/github.get.ts) rejects any GitHub identity
// not listed here. Members can invite more logins (server/api/members/*); every
// member currently has the same full access as the owner. The `isOwner` row is
// protected from removal so the instance always keeps its original claim.
// GitHub logins are case-insensitive, so `login` is always stored lowercased.
export const members = sqliteTable('members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  login: text('login').notNull().unique(),

  // Display profile, refreshed from GitHub on each login. Null until the member
  // has logged in at least once (an invited login is known before its profile).
  name: text('name'),
  avatarUrl: text('avatar_url'),

  // The claimed owner (seeded at setup). Exactly one; can't be removed.
  isOwner: integer('is_owner', { mode: 'boolean' }).notNull().default(false),
  // Login of the member who invited this one (null for the claimed owner).
  invitedBy: text('invited_by'),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type Member = typeof members.$inferSelect
export type NewMember = typeof members.$inferInsert
