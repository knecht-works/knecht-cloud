import { describe, expect, it, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
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

// The first test already applied every migration; these run the named ones again against the rows a test inserts.
function rerun(...names: string[]) {
  for (const name of names) db.delete(schema.dataMigrations).where(eq(schema.dataMigrations.name, name)).run()
  runDataMigrations()
}

function triggersOf(workflowId: number) {
  return db.select().from(schema.triggers).where(eq(schema.triggers.workflowId, workflowId)).orderBy(asc(schema.triggers.id)).all()
}

function expectValid(rows: (typeof schema.triggers.$inferSelect)[]) {
  for (const row of rows.filter(r => r.source !== 'schedule')) {
    expect(getTriggerSource(row.source, row.integration)!.configSchema.safeParse(row.config).success, `trigger ${row.id}`).toBe(true)
  }
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

  it('reshapes legacy github and jira trigger configs into single-event triggers', () => {
    const workflowId = db.insert(schema.workflows).values({ name: 'legacy-triggers', steps: [] }).returning().get().id
    const insert = (source: 'github' | 'jira' | 'schedule', config: Record<string, unknown>) =>
      db.insert(schema.triggers).values({ source: source as never, workflowId, projectIds: [], config }).returning().get().id
    const pr = insert('github', { event: 'pull_request', branches: ['main'], issueActions: ['opened'], issueLabel: null })
    const issues = insert('github', { event: 'issues', branches: [], issueActions: ['opened', 'labeled'], issueLabel: 'knecht' })
    const category = insert('jira', { event: 'transitioned', statusCategory: 'done', issueType: 'Bug' })
    const status = insert('jira', { event: 'transitioned', status: 'In Review' })
    const assigned = insert('jira', { event: 'assigned' })
    const current = insert('github', { kind: 'issue', on: [{ type: 'opened' }], filters: {} })
    const schedule = insert('schedule', {})

    rerun('0005_trigger_event_configs', '0006_trigger_conditions', '0007_trigger_event_values', '0009_trigger_roles', '0010_single_event_triggers')

    const rows = triggersOf(workflowId)
    const base = [{ field: 'base', op: 'is', values: ['main'] }]
    expect(rows.map(r => [r.id, r.source, r.integration, r.config])).toEqual([
      [pr, 'git', null, { kind: 'pull_request', event: { type: 'opened' }, conditions: base }],
      [issues, 'git', null, { kind: 'issue', event: { type: 'opened' }, conditions: [] }],
      [category, 'tracker', 'jira', { kind: 'issue', event: { type: 'entered' }, conditions: [{ field: 'issueType', op: 'is', values: ['Bug'] }], scope: { values: ['category:done'] } }],
      [status, 'tracker', 'jira', { kind: 'issue', event: { type: 'entered' }, conditions: [], scope: { values: ['In Review'] } }],
      [assigned, 'tracker', 'jira', { kind: 'issue', event: { type: 'assigned' }, conditions: [] }],
      [current, 'git', null, { kind: 'issue', event: { type: 'opened' }, conditions: [] }],
      [schedule, 'schedule', null, {}],
      [expect.any(Number), 'git', null, { kind: 'pull_request', event: { type: 'pushed' }, conditions: base }],
      [expect.any(Number), 'git', null, { kind: 'issue', event: { type: 'labeled', values: ['knecht'] }, conditions: [] }],
    ])
    expectValid(rows)
  })

  it('turns trigger filters into one group of conditions, authorNot into "author is not"', () => {
    const workflowId = db.insert(schema.workflows).values({ name: 'filter-triggers', steps: [] }).returning().get().id
    const insert = (source: 'github' | 'schedule', config: Record<string, unknown>) =>
      db.insert(schema.triggers).values({ source: source as never, workflowId, projectIds: [], config }).returning().get()
    const on = [{ type: 'opened' }]
    const filtered = insert('github', { kind: 'pull_request', on, filters: { base: ['main', 'releases/*'], authorNot: ['*[bot]'], draft: ['ready'] } })
    const bare = insert('github', { kind: 'issue', on, filters: {} })
    const current = insert('github', { kind: 'issue', on, conditions: [[{ field: 'label', op: 'is', values: ['bug'] }]] })
    const schedule = insert('schedule', {})

    rerun('0006_trigger_conditions', '0009_trigger_roles', '0010_single_event_triggers')

    const rows = triggersOf(workflowId)
    const event = { type: 'opened' }
    expect(rows.map(r => [r.id, r.config])).toEqual([
      [filtered.id, {
        kind: 'pull_request',
        event,
        conditions: [
          { field: 'base', op: 'is', values: ['main', 'releases/*'] },
          { field: 'author', op: 'is-not', values: ['*[bot]'] },
          { field: 'draft', op: 'is', values: ['ready'] },
        ],
      }],
      [bare.id, { kind: 'issue', event, conditions: [] }],
      [current.id, { kind: 'issue', event, conditions: [{ field: 'label', op: 'is', values: ['bug'] }] }],
      [schedule.id, {}],
    ])
    expectValid(rows)
  })

  it('gives every trigger a role and keeps the tracker of tracker triggers', () => {
    const workflowId = db.insert(schema.workflows).values({ name: 'role-triggers', steps: [] }).returning().get().id
    const lastFiredAt = new Date(1_700_000_000_000)
    const insert = (source: string, extra: Partial<typeof schema.triggers.$inferInsert> = {}) =>
      db.insert(schema.triggers).values({ source: source as never, workflowId, projectIds: [1], config: { kind: 'issue', on: [{ type: 'created' }], conditions: [] }, ...extra }).returning().get().id
    const ids = {
      github: insert('github', { active: false, firedCount: 3, lastFiredAt }),
      jira: insert('jira'),
      plane: insert('plane'),
      linear: insert('linear'),
      schedule: insert('schedule', { cron: '0 9 * * *', config: {} }),
    }

    rerun('0009_trigger_roles', '0010_single_event_triggers')

    const rowOf = (id: number) => db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()!
    expect(rowOf(ids.github)).toMatchObject({ source: 'git', integration: null, active: false, firedCount: 3, lastFiredAt, projectIds: [1], config: { kind: 'issue', event: { type: 'created' }, conditions: [] } })
    expect(rowOf(ids.jira)).toMatchObject({ source: 'tracker', integration: 'jira' })
    expect(rowOf(ids.plane)).toMatchObject({ source: 'tracker', integration: 'plane' })
    expect(rowOf(ids.linear)).toMatchObject({ source: 'tracker', integration: 'linear' })
    expect(rowOf(ids.schedule)).toMatchObject({ source: 'schedule', integration: null, cron: '0 9 * * *' })
  })

  it('is a no-op on the second run', () => {
    const before = getSteps('legacy')
    runDataMigrations()
    expect(getSteps('legacy')).toEqual(before)
  })
})

describe('0010_single_event_triggers', () => {
  let n = 0
  function setup(source: 'git' | 'tracker' | 'schedule', integration: 'jira' | 'plane' | 'linear' | null, config: Record<string, unknown>, extra: Partial<typeof schema.triggers.$inferInsert> = {}) {
    const workflowId = db.insert(schema.workflows).values({ name: `single-event-${++n}`, steps: [] }).returning().get().id
    const trigger = db.insert(schema.triggers).values({ source, integration, workflowId, projectIds: [3, 4], config, ...extra }).returning().get()
    rerun('0010_single_event_triggers')
    return { trigger, rows: triggersOf(workflowId) }
  }

  it('splits several events into one trigger each, keeping the firing history on the first', () => {
    const lastFiredAt = new Date(1_700_000_000_000)
    const { trigger, rows } = setup('git', null, { kind: 'issue', on: [{ type: 'opened' }, { type: 'labeled', values: ['bug'] }], conditions: [] }, { firedCount: 4, lastFiredAt })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: trigger.id, active: true, firedCount: 4, lastFiredAt, config: { kind: 'issue', event: { type: 'opened' }, conditions: [] } })
    expect(rows[1]).toMatchObject({
      source: 'git',
      integration: null,
      workflowId: trigger.workflowId,
      projectIds: [3, 4],
      active: true,
      firedCount: 0,
      lastFiredAt: null,
      config: { kind: 'issue', event: { type: 'labeled', values: ['bug'] }, conditions: [] },
    })
    expect(rows[1]!.id).not.toBe(trigger.id)
    expectValid(rows)
  })

  it('splits condition groups into one trigger each, per event', () => {
    const bug = { field: 'label', op: 'is', values: ['bug'] }
    const ann = { field: 'author', op: 'is', values: ['ann'] }
    const { rows } = setup('git', null, { kind: 'issue', on: [{ type: 'opened' }, { type: 'assigned', values: ['ann'] }], conditions: [[bug], [ann]] }, { active: false })

    expect(rows.map(r => [r.active, r.config])).toEqual([
      [false, { kind: 'issue', event: { type: 'opened' }, conditions: [bug] }],
      [false, { kind: 'issue', event: { type: 'opened' }, conditions: [ann] }],
      [false, { kind: 'issue', event: { type: 'assigned', values: ['ann'] }, conditions: [bug] }],
      [false, { kind: 'issue', event: { type: 'assigned', values: ['ann'] }, conditions: [ann] }],
    ])
    expectValid(rows)
  })

  it('turns a reached status into entered with the status as scope, in every tracker', () => {
    for (const [integration, key, value] of [['jira', 'status', 'category:done'], ['plane', 'state', 'group:completed'], ['linear', 'status', 'Done']] as const) {
      const { rows } = setup('tracker', integration, { kind: 'issue', on: [{ type: key, values: [value, 'Review'] }], conditions: [] })
      expect(rows.map(r => r.config), integration).toEqual([{ kind: 'issue', event: { type: 'entered' }, conditions: [], scope: { values: [value, 'Review'] } }])
      expectValid(rows)
    }
  })

  it('moves an "is" status condition into the scope', () => {
    const label = { field: 'label', op: 'is', values: ['bug'] }
    const { rows } = setup('tracker', 'plane', { kind: 'issue', on: [{ type: 'assigned' }], conditions: [[{ field: 'state', op: 'is', values: ['Todo', 'group:unstarted'] }, label]] })
    expect(rows.map(r => r.config)).toEqual([{ kind: 'issue', event: { type: 'assigned' }, conditions: [label], scope: { values: ['Todo', 'group:unstarted'] } }])
    expectValid(rows)
  })

  it('intersects an "is" status condition with the reached status, and keeps the reached status when nothing is left', () => {
    const { rows } = setup('tracker', 'jira', {
      kind: 'issue',
      on: [{ type: 'status', values: ['To Do', 'Review'] }],
      conditions: [[{ field: 'status', op: 'is', values: ['Review', 'Done'] }], [{ field: 'status', op: 'is', values: ['Done'] }]],
    })
    expect(rows.map(r => r.config)).toEqual([
      { kind: 'issue', event: { type: 'entered' }, conditions: [], scope: { values: ['Review'] } },
      { kind: 'issue', event: { type: 'entered' }, conditions: [], scope: { values: ['To Do', 'Review'] } },
    ])
    expectValid(rows)
  })

  it('deactivates the trigger an "is not" status condition belonged to, and logs it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const label = { field: 'label', op: 'is', values: ['bug'] }
    const { trigger, rows } = setup('tracker', 'jira', { kind: 'issue', on: [{ type: 'created' }], conditions: [[{ field: 'status', op: 'is-not', values: ['Done'] }], [label]] })

    expect(rows.map(r => [r.active, r.config])).toEqual([
      [false, { kind: 'issue', event: { type: 'created' }, conditions: [] }],
      [true, { kind: 'issue', event: { type: 'created' }, conditions: [label] }],
    ])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain(`trigger ${trigger.id}`)
    warn.mockRestore()
    expectValid(rows)
  })

  it('leaves schedules and already migrated triggers alone', () => {
    const migrated = { kind: 'issue', event: { type: 'opened' }, conditions: [] }
    expect(setup('schedule', null, {}, { cron: '0 9 * * *' }).rows).toMatchObject([{ config: {}, cron: '0 9 * * *', active: true }])
    expect(setup('git', null, migrated).rows.map(r => r.config)).toEqual([migrated])
  })
})
