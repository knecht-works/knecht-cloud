import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export interface EnvVar {
  key: string
  value: string
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

  // Per-project config (maintained on the project detail page — increment 2)
  siteUrl: text('site_url'),
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
