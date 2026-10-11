import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import { deleteWorkflow } from '../../server/stores/workflows'
import { getRun, makeProject, makeRun } from '../helpers/db'

describe('deleteWorkflow', () => {
  it('drops its triggers and unlinks runs and projects that reference it', () => {
    const workflow = db.insert(schema.workflows).values({ name: 'doomed', steps: [] }).returning().get()
    const kept = db.insert(schema.workflows).values({ name: 'kept', steps: [] }).returning().get()
    const project = makeProject({ starterWorkflowId: workflow.id })
    const run = makeRun(project, [], { workflowId: workflow.id })
    db.insert(schema.triggers).values({ source: 'schedule', cron: '0 9 * * *', workflowId: workflow.id, projectIds: [project.id] }).run()
    db.insert(schema.triggers).values({ source: 'schedule', cron: '0 9 * * *', workflowId: workflow.id, projectIds: [project.id] }).run()
    const otherTrigger = db.insert(schema.triggers).values({ source: 'schedule', cron: '0 9 * * *', workflowId: kept.id, projectIds: [project.id] }).returning().get()

    expect(deleteWorkflow(workflow.id)).toEqual({ deletedTriggers: 2 })

    expect(db.select().from(schema.workflows).where(eq(schema.workflows.id, workflow.id)).get()).toBeUndefined()
    expect(db.select().from(schema.triggers).where(eq(schema.triggers.workflowId, workflow.id)).all()).toEqual([])
    expect(db.select().from(schema.triggers).where(eq(schema.triggers.id, otherTrigger.id)).get()).toBeDefined()
    expect(getRun(run.id).workflowId).toBeNull()
    expect(db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get()!.starterWorkflowId).toBeNull()
  })
})
