import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { ENV_STATES } from '../../shared/utils/run'
import type { EnvVar } from '../../shared/utils/env'
import { PACKAGE_MANAGERS, type DetectedEnv } from '../../shared/utils/env-spec'
import { INTEGRATION_IDS, OBJECT_KINDS, TRIGGER_SOURCES } from '../../shared/utils/integrations'
import type { Step } from '../../shared/utils/workflow'

export interface DdevEnv {
  webserver: string | null
  phpVersion: string | null
  dbType: string | null
  dbVersion: string | null
  nodeVersion: string | null
  packageManager: string | null
  detected?: DetectedEnv
}

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),

  githubId: integer('github_id').notNull().unique(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  fullName: text('full_name').notNull(),
  defaultBranch: text('default_branch').notNull(),
  private: integer('private', { mode: 'boolean' }).notNull().default(false),
  cloneUrl: text('clone_url').notNull(),

  framework: text('framework'),
  frameworkVersion: text('framework_version'),
  ddevEnv: text('ddev_env', { mode: 'json' }).$type<DdevEnv>(),
  // '' = the repo scan found nothing (stops the backfill from re-hitting GitHub); null = unresolved.
  favicon: text('favicon'),

  envVars: text('env_vars', { mode: 'json' })
    .$type<EnvVar[]>()
    .notNull()
    .default(sql`'[]'`),
  urlMode: text('url_mode', { enum: ['env', 'rewrite'] })
    .notNull()
    .default('env'),
  dbDumpPath: text('db_dump_path'),
  dbImported: integer('db_imported', { mode: 'boolean' }).notNull().default(false),
  sharedFolders: text('shared_folders', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  agentInstructions: text('agent_instructions').notNull().default(''),

  bootCommands: text('boot_commands').notNull().default(''),

  phpVersion: text('php_version'),
  nodeVersion: text('node_version'),
  packageManager: text('package_manager', { enum: PACKAGE_MANAGERS }),
  devServer: text('dev_server'),
  previewPort: integer('preview_port'),

  mentionsEnabled: integer('mentions_enabled', { mode: 'boolean' }).notNull().default(true),
  // PRAGMA foreign_keys is off, so onDelete is declarative; the delete route nulls this.
  starterWorkflowId: integer('starter_workflow_id')
    .references(() => workflows.id, { onDelete: 'set null' }),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert

// Which external container of an integration (a Jira or Plane project) feeds a project.
// An external container feeds at most one project.
export const projectLinks = sqliteTable('project_links', {
  // PRAGMA foreign_keys is off, so the cascade is declarative; deleteProject removes links.
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  integration: text('integration', { enum: INTEGRATION_IDS }).notNull(),
  externalKey: text('external_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, table => [
  primaryKey({ columns: [table.projectId, table.integration] }),
  uniqueIndex('project_links_target_idx').on(table.integration, table.externalKey),
])

export type ProjectLink = typeof projectLinks.$inferSelect

// Env paths keep the `run-<id>` prefix with the SESSION id: the migration seeded one session per run.
export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),

  objectIntegration: text('object_integration', { enum: INTEGRATION_IDS }),
  objectKind: text('object_kind', { enum: OBJECT_KINDS }),
  objectKey: text('object_key'),
  objectUrl: text('object_url'),
  objectTitle: text('object_title'),

  status: text('status', { enum: ['open', 'closed'] })
    .notNull()
    .default('open'),

  branch: text('branch'),
  commitSha: text('commit_sha'),

  envState: text('env_state', { enum: ENV_STATES })
    .notNull()
    .default('down'),
  previewHosts: text('preview_hosts', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  // Also the guard against a second run re-importing the dump over the live DB.
  previewReady: integer('preview_ready', { mode: 'boolean' })
    .notNull()
    .default(false),
  // Pinned at checkout: the proxy must match what was baked into the env.
  urlMode: text('url_mode', { enum: ['env', 'rewrite'] }),
  // Pinned at first boot for the same reason.
  previewPort: integer('preview_port'),
  previewLastSeen: integer('preview_last_seen', { mode: 'timestamp' }),
  // The chat thread's session at the agent. Workflow ai steps never use it: each gets a fresh one.
  agentSessionId: text('agent_session_id'),
  // Written by /compact, read once by the next turn as the fresh session's opening context.
  agentHandover: text('agent_handover'),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  closedAt: integer('closed_at', { mode: 'timestamp' }),
}, table => [
  uniqueIndex('sessions_object_idx').on(table.projectId, table.objectIntegration, table.objectKind, table.objectKey),
  index('sessions_project_id_idx').on(table.projectId),
  index('sessions_env_state_idx').on(table.envState),
])

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert

export const runs = sqliteTable('runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  // PRAGMA foreign_keys is off, so the cascade is declarative; the delete routes clean up.
  sessionId: integer('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  workflow: text('workflow').notNull(),
  // FK actions are declarative only; the delete route nulls this explicitly.
  workflowId: integer('workflow_id')
    .references(() => workflows.id, { onDelete: 'set null' }),
  status: text('status', { enum: ['queued', 'running', 'success', 'failed', 'cancelled'] })
    .notNull()
    .default('queued'),
  // 'mention' rows are executed by their follow-up, never handed to the runner by the dispatcher.
  kind: text('kind', { enum: ['workflow', 'mention'] })
    .notNull()
    .default('workflow'),
  trigger: text('trigger'),
  triggerId: integer('trigger_id')
    .references(() => triggers.id, { onDelete: 'set null' }),
  branch: text('branch'),
  prUrl: text('pr_url'),
  inputs: text('inputs', { mode: 'json' }).$type<Record<string, string>>(),
  steps: text('steps', { mode: 'json' }).$type<Step[]>(),
  log: text('log').notNull().default(''),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, table => [
  index('runs_project_id_idx').on(table.projectId),
  index('runs_status_idx').on(table.status),
  index('runs_workflow_id_idx').on(table.workflowId),
  index('runs_session_id_idx').on(table.sessionId),
])

export type Run = typeof runs.$inferSelect
export type NewRun = typeof runs.$inferInsert

export const runSteps = sqliteTable('run_steps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  stepId: text('step_id').notNull(),
  type: text('type').notNull(),
  // The runner's resume logic only looks at 'workflow' rows.
  origin: text('origin', { enum: ['workflow', 'followup'] })
    .notNull()
    .default('workflow'),
  status: text('status', { enum: ['running', 'success', 'failed', 'cancelled'] })
    .notNull()
    .default('running'),
  params: text('params', { mode: 'json' }).$type<Record<string, unknown>>(),
  outputs: text('outputs', { mode: 'json' }).$type<Record<string, unknown>>(),
  error: text('error'),
  attempt: integer('attempt').notNull().default(1),
  // Captured before the row is inserted so the step banner is the first thing at the offset.
  logStart: integer('log_start'),
  parentStepId: text('parent_step_id'),
  iteration: integer('iteration'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
}, table => [
  index('run_steps_run_id_idx').on(table.runId),
])

export interface Attachment {
  name: string
  size: number
  type: string
}

export const followups = sqliteTable('followups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  runId: integer('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  prompt: text('prompt').notNull(),
  // Overrides settings.aiModel for this turn only.
  model: text('model'),
  // The files live under followupAttachmentsDir(id); the row only knows what is there.
  attachments: text('attachments', { mode: 'json' })
    .$type<Attachment[]>()
    .notNull()
    .default(sql`'[]'`),
  requestedBy: text('requested_by'),
  origin: text('origin', { enum: ['dashboard', 'mention'] })
    .notNull()
    .default('dashboard'),
  status: text('status', { enum: ['queued', 'running', 'success', 'failed'] })
    .notNull()
    .default('queued'),
  error: text('error'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, table => [
  index('followups_run_id_idx').on(table.runId),
  index('followups_session_id_idx').on(table.sessionId),
  index('followups_status_idx').on(table.status),
])

export type Followup = typeof followups.$inferSelect
export type NewFollowup = typeof followups.$inferInsert

export const AGENT_ITEM_TYPES = ['message', 'tool', 'usage', 'notice', 'divider'] as const
export type AgentItemType = (typeof AGENT_ITEM_TYPES)[number]

// One row per transcript item of a chat turn; the user's message is the follow-up row itself.
export const agentItems = sqliteTable('agent_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  followupId: integer('followup_id')
    .notNull()
    .references(() => followups.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  type: text('type', { enum: AGENT_ITEM_TYPES }).notNull(),
  // The message text, the tool title, the notice, or the divider label.
  text: text('text').notNull().default(''),
  kind: text('kind'),
  status: text('status', { enum: ['pending', 'in_progress', 'completed', 'failed'] }),
  input: text('input', { mode: 'json' }).$type<unknown>(),
  // Capped at a few KB when written; the full output is never kept.
  output: text('output'),
  diff: text('diff', { mode: 'json' }).$type<{ path: string, oldText: string | null, newText: string }>(),
  locations: text('locations', { mode: 'json' }).$type<string[]>(),
  cost: real('cost'),
  tokens: text('tokens', { mode: 'json' }).$type<{ used: number, size: number }>(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, table => [
  index('agent_items_followup_id_idx').on(table.followupId),
  index('agent_items_session_id_idx').on(table.sessionId),
])

export type AgentItem = typeof agentItems.$inferSelect

export const workflows = sqliteTable('workflows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  steps: text('steps', { mode: 'json' })
    .$type<Step[]>()
    .notNull()
    .default(sql`'[]'`),
  draftSteps: text('draft_steps', { mode: 'json' }).$type<Step[]>(),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  repliesEnabled: integer('replies_enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type WorkflowRow = typeof workflows.$inferSelect
export type NewWorkflowRow = typeof workflows.$inferInsert

export const settings = sqliteTable('settings', {
  id: integer('id').primaryKey(),

  idleStopMinutes: integer('idle_stop_minutes').notNull().default(1440),
  previewRetentionDays: integer('preview_retention_days').notNull().default(7),
  archiveRetentionDays: integer('archive_retention_days').notNull().default(30),
  maxConcurrentRuns: integer('max_concurrent_runs').notNull().default(2),

  aiProvider: text('ai_provider').notNull().default('anthropic'),
  aiRegion: text('ai_region', { enum: ['eu', 'us'] }).notNull().default('eu'),
  aiKeyEnc: text('ai_key_enc'),
  // Stored bare (no provider prefix). Both cleared on a provider switch: a stored
  // mismatch used to block saving the new provider's key.
  aiModel: text('ai_model').default('claude-sonnet-4-5'),
  aiSubtaskModel: text('ai_subtask_model'),

  agentInstructions: text('agent_instructions').notNull().default(''),

  workflowsSeeded: integer('workflows_seeded', { mode: 'boolean' }).notNull().default(false),

  sshTarget: text('ssh_target'),

  autoUpdateCron: text('auto_update_cron').notNull().default(''),
})

export type Settings = typeof settings.$inferSelect

export const dataMigrations = sqliteTable('data_migrations', {
  name: text('name').primaryKey(),
  appliedAt: integer('applied_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export const triggers = sqliteTable('triggers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source', { enum: TRIGGER_SOURCES }).notNull(),
  // PRAGMA foreign_keys is off, so the cascade is declarative; the delete route removes triggers.
  workflowId: integer('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  projectIds: text('project_ids', { mode: 'json' })
    .$type<number[]>()
    .notNull()
    .default(sql`'[]'`),

  cron: text('cron'),
  nextFireAt: integer('next_fire_at', { mode: 'timestamp' }),

  config: text('config', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),

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

export const githubApp = sqliteTable('github_app', {
  id: integer('id').primaryKey(),

  appId: text('app_id').notNull(),
  slug: text('slug'),
  htmlUrl: text('html_url'),
  clientId: text('client_id').notNull(),

  clientSecretEnc: text('client_secret_enc').notNull(),
  privateKeyEnc: text('private_key_enc').notNull(),
  webhookSecretEnc: text('webhook_secret_enc'),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type GithubAppRow = typeof githubApp.$inferSelect
export type NewGithubAppRow = typeof githubApp.$inferInsert

export const jiraConnection = sqliteTable('jira_connection', {
  id: integer('id').primaryKey(),

  siteUrl: text('site_url').notNull(),
  email: text('email').notNull(),
  apiTokenEnc: text('api_token_enc').notNull(),
  accountName: text('account_name'),
  accountId: text('account_id'),
  webhookSecretEnc: text('webhook_secret_enc'),
  // Jira shows no delivery log, so the settings page reports what arrived here.
  lastDeliveryAt: integer('last_delivery_at', { mode: 'timestamp' }),
  lastDeliverySummary: text('last_delivery_summary'),
  lastRejectedAt: integer('last_rejected_at', { mode: 'timestamp' }),
  lastRejectedReason: text('last_rejected_reason', { enum: ['signature', 'empty-body', 'no-project'] }),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type JiraConnectionRow = typeof jiraConnection.$inferSelect

export const planeConnection = sqliteTable('plane_connection', {
  id: integer('id').primaryKey(),

  siteUrl: text('site_url').notNull(),
  workspaceSlug: text('workspace_slug').notNull(),
  apiKeyEnc: text('api_key_enc').notNull(),
  accountName: text('account_name'),
  accountId: text('account_id'),
  // Plane mints the secret when the webhook is created there; the admin pastes it here.
  webhookSecretEnc: text('webhook_secret_enc'),
  lastDeliveryAt: integer('last_delivery_at', { mode: 'timestamp' }),
  lastDeliverySummary: text('last_delivery_summary'),
  lastRejectedAt: integer('last_rejected_at', { mode: 'timestamp' }),
  lastRejectedReason: text('last_rejected_reason', { enum: ['signature', 'empty-body', 'no-project'] }),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type PlaneConnectionRow = typeof planeConnection.$inferSelect

// GitHub logins are case-insensitive, so `login` is always stored lowercased.
export const members = sqliteTable('members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  login: text('login').notNull().unique(),

  name: text('name'),
  avatarUrl: text('avatar_url'),

  isOwner: integer('is_owner', { mode: 'boolean' }).notNull().default(false),
  invitedBy: text('invited_by'),

  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type Member = typeof members.$inferSelect
export type NewMember = typeof members.$inferInsert
