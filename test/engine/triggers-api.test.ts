import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { makeProject } from '../helpers/db'

vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { db, schema } = await import('../../server/db')
const { setProjectLink } = await import('../../server/utils/project-links')
const create = (await import('../../server/api/triggers/index.post')).default
const patch = (await import('../../server/api/triggers/[id].patch')).default

let n = 0
function makeWorkflow() {
  return db.insert(schema.workflows).values({
    name: `triggers-api-${++n}`,
    steps: [{ type: 'bash', command: 'true', id: 'run' }],
    publishedAt: new Date(),
  }).returning().get()
}

function post(body: object) {
  return callRoute(create, { body })
}

function update(id: number, body: object) {
  return callRoute(patch, { method: 'PATCH', route: '/triggers/:id', path: `/triggers/${id}`, body })
}

function row(id: number) {
  return db.select().from(schema.triggers).where(eq(schema.triggers.id, id)).get()!
}

describe('POST /api/triggers', () => {
  it('creates a schedule trigger with its next firing time', async () => {
    const project = makeProject()
    const wf = makeWorkflow()
    const res = await post({ source: 'schedule', workflowId: wf.id, projectIds: [project.id], cron: '0 9 * * *' })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ source: 'schedule', endpoint: '0 9 * * *', workflowName: wf.name, projects: ['test-php'], active: true })
    expect((res.json as { event: string }).event).toMatch(/^Next run /)
    expect(row((res.json as { id: number }).id).nextFireAt).not.toBeNull()
  })

  it('rejects an invalid cron expression', async () => {
    const res = await post({ source: 'schedule', workflowId: makeWorkflow().id, projectIds: [], cron: 'every day' })
    expect(res.status).toBe(400)
    expect(res.json).toMatchObject({ statusMessage: 'Invalid cron expression' })
  })

  it('creates a github trigger with push defaults and describes it', async () => {
    const project = makeProject()
    const res = await post({ source: 'github', workflowId: makeWorkflow().id, projectIds: [project.id] })
    expect(res.status).toBe(200)
    expect(res.json).toMatchSnapshot({
      id: expect.any(Number),
      workflowId: expect.any(Number),
      workflowName: expect.any(String),
      projectIds: [expect.any(Number)],
    })
  })

  it('describes github triggers by event, branches and labels', async () => {
    const wf = makeWorkflow()
    const pr = await post({ source: 'github', workflowId: wf.id, projectIds: [], config: { event: 'pull_request', branches: ['main', 'staging'] } })
    expect(pr.json).toMatchObject({ event: 'On pull_request · base main, staging' })
    const issues = await post({ source: 'github', workflowId: wf.id, projectIds: [], config: { event: 'issues', issueActions: ['opened', 'labeled'], issueLabel: 'knecht' } })
    expect(issues.json).toMatchObject({ event: 'On issues · opened, label "knecht"' })
  })

  it('requires a label to trigger on labeled issues', async () => {
    const res = await post({ source: 'github', workflowId: makeWorkflow().id, projectIds: [], config: { event: 'issues', issueActions: ['labeled'] } })
    expect(res.status).toBe(400)
    expect(res.json).toMatchObject({ statusMessage: 'A label is required to trigger on "labeled"' })
  })

  it('creates a manual trigger', async () => {
    const res = await post({ source: 'manual', workflowId: makeWorkflow().id, projectIds: [] })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ source: 'manual', event: 'Run on demand', endpoint: null })
  })

  it('creates a jira trigger only for exactly one project linked to a Jira project', async () => {
    const wf = makeWorkflow()
    const linked = makeProject()
    setProjectLink(linked.id, 'jira', 'API')
    const unlinked = makeProject()
    expect((await post({ source: 'jira', workflowId: wf.id, projectIds: [linked.id, unlinked.id], config: { event: 'created' } })).json)
      .toMatchObject({ statusMessage: 'A Jira trigger fires for exactly one project' })
    expect((await post({ source: 'jira', workflowId: wf.id, projectIds: [unlinked.id], config: { event: 'created' } })).json)
      .toMatchObject({ statusMessage: expect.stringContaining('Link knecht-works/test-php to a Jira project first') })
    expect((await post({ source: 'jira', workflowId: wf.id, projectIds: [linked.id], config: { event: 'labeled' } })).json)
      .toMatchObject({ statusMessage: 'A label is required to trigger on "labeled"' })
    const res = await post({ source: 'jira', workflowId: wf.id, projectIds: [linked.id], config: { event: 'labeled', label: 'knecht', issueType: 'Bug' } })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ source: 'jira', event: 'On label "knecht" · Bug', config: { event: 'labeled', label: 'knecht', issueType: 'Bug' } })
  })

  it('refuses an unknown workflow', async () => {
    const res = await post({ source: 'manual', workflowId: 999_999, projectIds: [] })
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/triggers/:id', () => {
  it('toggles active and recomputes the schedule', async () => {
    const created = await post({ source: 'schedule', workflowId: makeWorkflow().id, projectIds: [], cron: '0 9 * * *' })
    const id = (created.json as { id: number }).id
    const paused = await update(id, { active: false })
    expect(paused.json).toMatchObject({ active: false, event: 'Paused' })
    expect(row(id).nextFireAt).toBeNull()
    const resumed = await update(id, { active: true })
    expect(resumed.json).toMatchObject({ active: true })
    expect(row(id).nextFireAt).not.toBeNull()
  })

  it('switching a github trigger to a schedule clears the github config', async () => {
    const created = await post({ source: 'github', workflowId: makeWorkflow().id, projectIds: [], config: { event: 'issues', issueActions: ['labeled'], issueLabel: 'knecht' } })
    const id = (created.json as { id: number }).id
    const res = await update(id, { source: 'schedule', cron: '*/15 * * * *' })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ source: 'schedule', endpoint: '*/15 * * * *', config: {} })
  })

  it('switching a schedule to github clears the cron and validates the label', async () => {
    const created = await post({ source: 'schedule', workflowId: makeWorkflow().id, projectIds: [], cron: '0 9 * * *' })
    const id = (created.json as { id: number }).id
    const bad = await update(id, { source: 'github', config: { event: 'issues', issueActions: ['labeled'] } })
    expect(bad.status).toBe(400)
    const res = await update(id, { source: 'github', config: { event: 'issues', issueActions: ['labeled'], issueLabel: 'go' } })
    expect(res.json).toMatchObject({ source: 'github', endpoint: null, event: 'On issues · label "go"' })
    expect(row(id)).toMatchObject({ cron: null, nextFireAt: null })
  })

  it('updates workflow and projects', async () => {
    const created = await post({ source: 'manual', workflowId: makeWorkflow().id, projectIds: [] })
    const id = (created.json as { id: number }).id
    const wf = makeWorkflow()
    const project = makeProject({ name: 'other' })
    const res = await update(id, { workflowId: wf.id, projectIds: [project.id] })
    expect(res.json).toMatchObject({ workflowId: wf.id, workflowName: wf.name, projects: ['other'] })
  })

  it('keeps the config when only projects change', async () => {
    const created = await post({ source: 'github', workflowId: makeWorkflow().id, projectIds: [], config: { event: 'issues', issueActions: ['labeled'], issueLabel: 'knecht' } })
    const id = (created.json as { id: number }).id
    const res = await update(id, { projectIds: [makeProject().id] })
    expect(res.json).toMatchObject({ event: 'On issues · label "knecht"' })
  })

  it('answers 404 for an unknown trigger', async () => {
    const res = await update(999_999, { active: false })
    expect(res.status).toBe(404)
  })
})
