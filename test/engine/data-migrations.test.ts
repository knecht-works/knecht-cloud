import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import { runDataMigrations } from '../../server/db/data-migrations'
import { getTriggerSource } from '../../server/utils/trigger-sources'
import type { Step } from '../../shared/utils/workflow'
import { makeProject, makeRun } from '../helpers/db'

// The engine setup runs the SQL migrations but not runDataMigrations, so they execute here.

function makeWorkflow(name: string, steps: Step[]) {
  db.insert(schema.workflows).values({ name, steps }).run()
}

function getSteps(name: string): Step[] {
  return db.select().from(schema.workflows).where(eq(schema.workflows.name, name)).get()!.steps
}

describe('runDataMigrations', () => {
  it('strips known provider prefixes from ai-step models, also in nested steps', () => {
    makeWorkflow('legacy', [
      { id: 'one', type: 'ai', prompt: 'p', model: 'anthropic/claude-sonnet-4-5' },
      {
        id: 'guard',
        type: 'if',
        conditions: [],
        then: [{ id: 'two', type: 'ai', prompt: 'p', model: 'opencode/kimi-k2' }],
        else: [],
      } as unknown as Step,
    ])
    makeWorkflow('modern', [
      { id: 'bare', type: 'ai', prompt: 'p', model: 'claude-sonnet-4-5' },
      { id: 'slashed', type: 'ai', prompt: 'p', model: 'meta-llama/llama-3.3-70b' },
      { id: 'none', type: 'ai', prompt: 'p' },
    ])

    runDataMigrations()

    const legacy = getSteps('legacy')
    expect(legacy[0]).toMatchObject({ model: 'claude-sonnet-4-5' })
    expect((legacy[1] as Extract<Step, { type: 'if' }>).then[0]).toMatchObject({ model: 'kimi-k2' })
    const modern = getSteps('modern')
    expect(modern[0]).toMatchObject({ model: 'claude-sonnet-4-5' })
    expect(modern[1]).toMatchObject({ model: 'meta-llama/llama-3.3-70b' })
    expect(modern[2]).not.toHaveProperty('model')

    const applied = db.select().from(schema.dataMigrations).all().map(r => r.name)
    expect(applied).toContain('0002_bare_ai_step_models')
  })

  it('copies the reply of an old follow-up step row into a message item', () => {
    const run = makeRun(makeProject(), [])
    const answered = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'a', status: 'success' }).returning().get()
    const silent = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'b', status: 'failed' }).returning().get()
    const base = { runId: run.id, stepIndex: 0, type: 'ai', origin: 'followup' as const, status: 'success' as const }
    db.insert(schema.runSteps).values({ ...base, stepId: `followup-${answered.id}`, outputs: { text: 'Done, see the diff.' } }).run()
    db.insert(schema.runSteps).values({ ...base, stepId: `followup-${silent.id}`, outputs: { text: '' } }).run()

    db.delete(schema.dataMigrations).where(eq(schema.dataMigrations.name, '0004_followup_reply_items')).run()
    runDataMigrations()

    const items = db.select().from(schema.agentItems).where(eq(schema.agentItems.sessionId, run.sessionId)).all()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ followupId: answered.id, seq: 0, type: 'message', text: 'Done, see the diff.' })
  })

  it('turns steps stored as failed with the Cancelled error into cancelled steps', () => {
    const run = makeRun(makeProject(), [])
    const base = { runId: run.id, stepIndex: 0, stepId: 's', type: 'bash' }
    const aborted = db.insert(schema.runSteps).values({ ...base, status: 'failed', error: 'Cancelled' }).returning().get()
    const failed = db.insert(schema.runSteps).values({ ...base, status: 'failed', error: 'exit 1' }).returning().get()

    // The first test already applied every migration; rerun this one against the rows above.
    db.delete(schema.dataMigrations).where(eq(schema.dataMigrations.name, '0003_cancelled_step_rows')).run()
    runDataMigrations()

    expect(db.select().from(schema.runSteps).where(eq(schema.runSteps.id, aborted.id)).get()).toMatchObject({ status: 'cancelled', error: null })
    expect(db.select().from(schema.runSteps).where(eq(schema.runSteps.id, failed.id)).get()).toMatchObject({ status: 'failed', error: 'exit 1' })
  })

  it('reshapes github and jira trigger configs into events with value lists and conditions', () => {
    const workflowId = db.insert(schema.workflows).values({ name: 'legacy-triggers', steps: [] }).returning().get().id
    const insert = (source: 'github' | 'jira' | 'schedule', config: Record<string, unknown>) =>
      db.insert(schema.triggers).values({ source, workflowId, projectIds: [], config }).returning().get().id
    const configOf = (id: number) => db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()!.config

    const pr = insert('github', { event: 'pull_request', branches: ['main'], issueActions: ['opened'], issueLabel: null })
    const issues = insert('github', { event: 'issues', branches: [], issueActions: ['opened', 'labeled'], issueLabel: 'knecht' })
    const category = insert('jira', { event: 'transitioned', statusCategory: 'done', issueType: 'Bug' })
    const status = insert('jira', { event: 'transitioned', status: 'In Review' })
    const assigned = insert('jira', { event: 'assigned' })
    const current = insert('github', { kind: 'issue', on: [{ type: 'opened' }], filters: {} })
    const schedule = insert('schedule', {})

    for (const name of ['0005_trigger_event_configs', '0006_trigger_conditions', '0007_trigger_event_values']) {
      db.delete(schema.dataMigrations).where(eq(schema.dataMigrations.name, name)).run()
    }
    runDataMigrations()

    expect(configOf(pr)).toEqual({ kind: 'pull_request', on: [{ type: 'opened' }, { type: 'pushed' }], conditions: [[{ field: 'base', op: 'is', values: ['main'] }]] })
    expect(configOf(issues)).toEqual({ kind: 'issue', on: [{ type: 'opened' }, { type: 'labeled', values: ['knecht'] }], conditions: [] })
    expect(configOf(category)).toEqual({ kind: 'issue', on: [{ type: 'status', values: ['category:done'] }], conditions: [[{ field: 'issueType', op: 'is', values: ['Bug'] }]] })
    expect(configOf(status)).toEqual({ kind: 'issue', on: [{ type: 'status', values: ['In Review'] }], conditions: [] })
    expect(configOf(assigned)).toEqual({ kind: 'issue', on: [{ type: 'assigned' }], conditions: [] })
    expect(configOf(current)).toEqual({ kind: 'issue', on: [{ type: 'opened' }], conditions: [] })
    expect(configOf(schedule)).toEqual({})
    for (const id of [pr, issues, category, status, assigned]) {
      const row = db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()!
      expect(getTriggerSource(row.source)!.configSchema.safeParse(row.config).success).toBe(true)
    }
  })

  it('turns trigger filters into one group of conditions, authorNot into "author is not"', () => {
    const workflowId = db.insert(schema.workflows).values({ name: 'filter-triggers', steps: [] }).returning().get().id
    const insert = (source: 'github' | 'schedule', config: Record<string, unknown>) =>
      db.insert(schema.triggers).values({ source, workflowId, projectIds: [], config }).returning().get()
    const on = [{ type: 'opened' }]
    const filtered = insert('github', { kind: 'pull_request', on, filters: { base: ['main', 'releases/*'], authorNot: ['*[bot]'], draft: ['ready'] } })
    const bare = insert('github', { kind: 'issue', on, filters: {} })
    const current = insert('github', { kind: 'issue', on, conditions: [[{ field: 'label', op: 'is', values: ['bug'] }]] })
    const schedule = insert('schedule', {})

    db.delete(schema.dataMigrations).where(eq(schema.dataMigrations.name, '0006_trigger_conditions')).run()
    runDataMigrations()

    const configOf = (id: number) => db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()!.config
    expect(configOf(filtered.id)).toEqual({
      kind: 'pull_request',
      on,
      conditions: [[
        { field: 'base', op: 'is', values: ['main', 'releases/*'] },
        { field: 'author', op: 'is-not', values: ['*[bot]'] },
        { field: 'draft', op: 'is', values: ['ready'] },
      ]],
    })
    expect(configOf(bare.id)).toEqual({ kind: 'issue', on, conditions: [] })
    expect(configOf(current.id)).toEqual(current.config)
    expect(configOf(schedule.id)).toEqual({})
    expect(getTriggerSource('github')!.configSchema.safeParse(configOf(filtered.id)).success).toBe(true)
  })

  it('is a no-op on the second run', () => {
    const before = getSteps('legacy')
    runDataMigrations()
    expect(getSteps('legacy')).toEqual(before)
  })
})
