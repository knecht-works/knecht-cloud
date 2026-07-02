import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { Step } from '../workflows/schema'

export interface EnvVar {
  key: string
  value: string
}

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
  // The branch the run works on: the project's default branch at checkout,
  // replaced by the branch a `create-branch` step creates.
  branch: text('branch'),
  // The pull request a `create-pr` step opened, if the run opened one.
  prUrl: text('pr_url'),
  log: text('log').notNull().default(''),
  // The run's isolated ddev environment: 'down' (not booted / torn down), 'up'
  // (running, previewable), 'stopped' (idle-stopped — volumes kept, rebootable).
  envState: text('env_state', { enum: ['down', 'up', 'stopped'] })
    .notNull()
    .default('down'),
  // The repo's own ddev host (e.g. ganzlebendig.ddev.site), read from
  // .ddev/config.yaml at boot. It's the host the booted app generates URLs for
  // (the pasted .env points at it) and the Host header the proxy sends — and
  // what the proxy rewrites to the preview origin in responses.
  previewHost: text('preview_host'),
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
})

export type Run = typeof runs.$inferSelect
export type NewRun = typeof runs.$inferInsert

// User-created (or edited) workflows. The bundled workflows live in code
// (server/workflows/index.ts) as a fallback; a row here with the same `name`
// overrides its built-in, and deleting that row reverts to the built-in. Steps
// are stored in their normalized form — the same shape the runner consumes.
export const workflows = sqliteTable('workflows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  steps: text('steps', { mode: 'json' })
    .$type<Step[]>()
    .notNull()
    .default(sql`'[]'`),
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
// consumes a docker network from a finite pool and disk for its volumes). The
// OpenRouter key/model for the `knecht` block will join this row later.
export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(), // singleton — always 1

  // Stop a run's env (frees its network + host ports, keeps volumes so it can be
  // rebooted) after it has been idle — no preview access — this many minutes.
  idleStopMinutes: integer('idle_stop_minutes').notNull().default(30),

  // Hard cap on simultaneously-running ('up') envs. Booting a new run first
  // stops the least-recently-previewed envs until fewer than this remain, so the
  // docker network pool can never be exhausted by Knecht.
  maxConcurrentEnvs: integer('max_concurrent_envs').notNull().default(5),

  // Fully delete a 'stopped' env (reclaiming its volumes + worktree) once it has
  // been untouched this many minutes. 0 disables auto-deletion (kept until the
  // run is deleted).
  teardownStoppedMinutes: integer('teardown_stopped_minutes').notNull().default(180),
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

// The latest GitHub OAuth token, remembered so background trigger runs (fired by
// the scheduler or an inbound webhook — both without a session) have the same
// clone/PR credential the session would carry. The token otherwise only lives in
// the encrypted session cookie. Single row (id = 1), refreshed on login and on
// every manual run. A single-user instance, so "the last token" is "the token".
export const credentials = sqliteTable('credentials', {
  id: integer('id').primaryKey(), // singleton — always 1
  githubToken: text('github_token').notNull(),
  githubLogin: text('github_login'),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type Credentials = typeof credentials.$inferSelect
