import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import { fireTrigger } from '../../server/utils/triggers'
import { makeProject } from '../helpers/db'

// Created runs are marked failed immediately: the test env has no GitHub App.

let n = 0
function makeWorkflow(overrides: Partial<typeof schema.workflows.$inferInsert> = {}) {
  return db.insert(schema.workflows).values({
    name: `gate-test-${++n}`,
    steps: [{ type: 'bash', command: 'true', id: 'run' }],
    ...overrides,
  }).returning().get()
}

function makeTrigger(workflowId: number, projectIds: number[]) {
  return db.insert(schema.triggers).values({ source: 'schedule', cron: '0 9 * * *', workflowId, projectIds }).returning().get()
}

function runsOf(workflowId: number) {
  return db.select().from(schema.runs).where(eq(schema.runs.workflowId, workflowId)).all()
}

describe('fireTrigger publish/enabled gate', () => {
  it('does not fire an unpublished workflow', () => {
    const project = makeProject()
    const wf = makeWorkflow({ publishedAt: null })
    const trigger = makeTrigger(wf.id, [project.id])

    expect(fireTrigger(trigger)).toEqual([])
    expect(runsOf(wf.id)).toHaveLength(0)
    const after = db.select().from(schema.triggers).where(eq(schema.triggers.id, trigger.id)).get()!
    expect(after.firedCount).toBe(0)
  })

  it('does not fire while automation is paused', () => {
    const project = makeProject()
    const wf = makeWorkflow({ publishedAt: new Date(), enabled: false })
    const trigger = makeTrigger(wf.id, [project.id])

    expect(fireTrigger(trigger)).toEqual([])
    expect(runsOf(wf.id)).toHaveLength(0)
  })

  it('fires a published workflow, stamping the run with name and id', () => {
    const project = makeProject()
    const wf = makeWorkflow({ publishedAt: new Date() })
    const trigger = makeTrigger(wf.id, [project.id])

    const runIds = fireTrigger(trigger)
    expect(runIds).toHaveLength(1)

    const runs = runsOf(wf.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ workflow: wf.name, workflowId: wf.id, triggerId: trigger.id })
  })
})

describe('fireTrigger object version', () => {
  const object = { integration: 'github' as const, kind: 'issue' as const, key: '7' }

  it('runs once per version of an object, and again on a new version', () => {
    const project = makeProject()
    const wf = makeWorkflow({ publishedAt: new Date() })
    const trigger = makeTrigger(wf.id, [project.id])

    expect(fireTrigger(trigger, { object, version: '100' })).toHaveLength(1)
    expect(fireTrigger(trigger, { object, version: '100' })).toEqual([])
    const after = db.select().from(schema.triggers).where(eq(schema.triggers.id, trigger.id)).get()!
    expect(after.firedCount).toBe(1)
    expect(fireTrigger(trigger, { object, version: '101' })).toHaveLength(1)
    expect(runsOf(wf.id).map(r => r.objectVersion)).toEqual(['100', '101'])
  })

  it('keeps other triggers and other objects apart, and never skips without a version', () => {
    const project = makeProject()
    const wf = makeWorkflow({ publishedAt: new Date() })
    const trigger = makeTrigger(wf.id, [project.id])
    const other = makeTrigger(wf.id, [project.id])

    fireTrigger(trigger, { object, version: '100' })
    expect(fireTrigger(other, { object, version: '100' })).toHaveLength(1)
    expect(fireTrigger(trigger, { object: { ...object, key: '8' }, version: '100' })).toHaveLength(1)
    expect(fireTrigger(trigger, { object })).toHaveLength(1)
    expect(fireTrigger(trigger, { object })).toHaveLength(1)
  })
})
