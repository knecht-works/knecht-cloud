import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import { fireTrigger } from '../../server/utils/triggers'
import { makeProject } from '../helpers/db'

// fireTrigger's gate: automation fires only a PUBLISHED workflow whose master
// switch is on. (The runs it creates are marked failed immediately because the
// test env has no GitHub App, so nothing actually executes.)

let n = 0
function makeWorkflow(overrides: Partial<typeof schema.workflows.$inferInsert> = {}) {
  return db.insert(schema.workflows).values({
    name: `gate-test-${++n}`,
    steps: [{ type: 'bash', command: 'true', id: 'run' }],
    ...overrides,
  }).returning().get()
}

function makeTrigger(workflowId: number, projectIds: number[]) {
  return db.insert(schema.triggers).values({ source: 'manual', workflowId, projectIds }).returning().get()
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
    // The fire counter stays untouched too: nothing happened.
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
