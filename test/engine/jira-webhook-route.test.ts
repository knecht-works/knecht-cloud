import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { getSessionRow, makeProject } from '../helpers/db'

const api = vi.hoisted(() => ({
  comments: [] as { key: string, body: unknown }[],
  fetched: {
    id: '77',
    body: null as unknown,
    author: { accountId: 'user-1', displayName: 'Ann Example' },
  },
}))
vi.mock('../../server/integrations/jira/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/jira/api')>(),
  getJiraComment: async () => api.fetched,
  addJiraComment: async (key: string, body: unknown) => {
    api.comments.push({ key, body })
    return { url: `https://acme.atlassian.net/browse/${key}` }
  },
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { db, schema } = await import('../../server/db')
const { jiraCredentials, saveJiraCredentials } = await import('../../server/integrations/jira/credentials')
const { resolveSession } = await import('../../server/utils/sessions')
const handler = (await import('../../server/api/jira/webhook.post')).default

const KNECHT_ACCOUNT = 'knecht-account-id'

function deliver(payload: object, secret = jiraCredentials()?.webhookSecret ?? '') {
  const raw = JSON.stringify(payload)
  return callRoute(handler, {
    body: raw,
    headers: { 'x-hub-signature': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` },
  })
}

let n = 0
function makeWorkflow() {
  return db.insert(schema.workflows).values({
    name: `jira-route-${++n}`,
    steps: [{ type: 'bash', command: 'true', id: 'run' }],
    publishedAt: new Date(),
  }).returning().get()
}

let keyN = 0
function makeJiraProject() {
  return makeProject({ jiraProjectKey: `P${++keyN}` })
}

function makeJiraTrigger(projectId: number, config: Record<string, unknown>) {
  return db.insert(schema.triggers).values({
    source: 'jira',
    workflowId: makeWorkflow().id,
    projectIds: [projectId],
    config,
  }).returning().get()
}

function runsOf(triggerId: number) {
  return db.select().from(schema.runs).where(eq(schema.runs.triggerId, triggerId)).all()
}

const doc = (text: string) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

function issue(project: { jiraProjectKey: string | null }, overrides: Record<string, unknown> = {}) {
  return {
    key: `${project.jiraProjectKey}-12`,
    fields: {
      summary: 'Login broken',
      description: doc('It fails on submit.'),
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      assignee: null,
      reporter: { accountId: 'user-1', displayName: 'Ann Example' },
      labels: ['knecht', 'bug'],
      issuetype: { name: 'Bug' },
      project: { key: project.jiraProjectKey },
      ...overrides,
    },
  }
}

function updated(project: { jiraProjectKey: string | null }, items: object[], fields: Record<string, unknown> = {}) {
  return { webhookEvent: 'jira:issue_updated', issue: issue(project, fields), changelog: { items } }
}

describe('jira webhook route, unconfigured', () => {
  it('answers 404 until Jira is connected', async () => {
    const res = await deliver({ webhookEvent: 'jira:issue_created' }, 'anything')
    expect(res.status).toBe(404)
  })
})

describe('jira webhook route', () => {
  beforeAll(() => {
    saveJiraCredentials({ siteUrl: 'https://acme.atlassian.net', email: 'knecht@acme.test', apiToken: 't', accountName: 'Knecht', accountId: KNECHT_ACCOUNT })
  })

  it('rejects a bad signature', async () => {
    const res = await deliver({ webhookEvent: 'jira:issue_created' }, 'wrong')
    expect(res.status).toBe(401)
  })

  it('skips tickets of Jira projects no project is linked to', async () => {
    const res = await deliver({ webhookEvent: 'jira:issue_created', issue: issue({ jiraProjectKey: 'NOPE' }) })
    expect(res.json).toEqual({ ok: true, skipped: 'no matching project' })
  })

  it('fires on a created ticket with the ticket as inputs and object', async () => {
    const project = makeJiraProject()
    const trigger = makeJiraTrigger(project.id, { event: 'created' })
    const res = await deliver({ webhookEvent: 'jira:issue_created', issue: issue(project) })
    expect(res.json).toEqual({ ok: true, runIds: [expect.any(Number)] })
    const [run] = runsOf(trigger.id)
    expect(run).toMatchObject({
      trigger: 'jira',
      branch: 'main',
      inputs: {
        event: 'issue',
        identifier: `${project.jiraProjectKey}-12`,
        title: 'Login broken',
        body: 'It fails on submit.',
        url: `https://acme.atlassian.net/browse/${project.jiraProjectKey}-12`,
        status: 'To Do',
        assignee: '',
        labels: 'knecht, bug',
        author: 'Ann Example',
      },
    })
    expect(getSessionRow(run!.sessionId)).toMatchObject({
      objectIntegration: 'jira',
      objectKind: 'issue',
      objectKey: `${project.jiraProjectKey}-12`,
      objectTitle: 'Login broken',
      objectUrl: `https://acme.atlassian.net/browse/${project.jiraProjectKey}-12`,
    })
  })

  it('fires on a label only when the ticket gains it', async () => {
    const project = makeJiraProject()
    const trigger = makeJiraTrigger(project.id, { event: 'labeled', label: 'knecht' })

    await deliver(updated(project, [{ field: 'labels', fromString: 'knecht', toString: 'knecht bug' }]))
    await deliver(updated(project, [{ field: 'labels', fromString: '', toString: 'other' }]))
    expect(runsOf(trigger.id)).toHaveLength(0)

    await deliver(updated(project, [{ field: 'labels', fromString: 'bug', toString: 'bug knecht' }]))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires on a ticket created with the label, the status or the assignment already set', async () => {
    const project = makeJiraProject()
    const labeled = makeJiraTrigger(project.id, { event: 'labeled', label: 'knecht' })
    const transitioned = makeJiraTrigger(project.id, { event: 'transitioned', status: 'In Progress' })
    const assigned = makeJiraTrigger(project.id, { event: 'assigned' })

    await deliver({ webhookEvent: 'jira:issue_created', issue: issue(project, { labels: ['bug'] }) })
    expect(runsOf(labeled.id)).toHaveLength(0)
    expect(runsOf(transitioned.id)).toHaveLength(0)
    expect(runsOf(assigned.id)).toHaveLength(0)

    await deliver({ webhookEvent: 'jira:issue_created', issue: issue(project, {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { accountId: KNECHT_ACCOUNT, displayName: 'Knecht' },
    }) })
    expect(runsOf(labeled.id)).toHaveLength(1)
    expect(runsOf(transitioned.id)).toHaveLength(1)
    expect(runsOf(assigned.id)).toHaveLength(1)
  })

  it('fires on a transition to the configured status', async () => {
    const project = makeJiraProject()
    const trigger = makeJiraTrigger(project.id, { event: 'transitioned', status: 'In Progress' })
    await deliver(updated(project, [{ field: 'status', fromString: 'To Do', toString: 'Done' }]))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }]))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires when the ticket is assigned to the connection account', async () => {
    const project = makeJiraProject()
    const trigger = makeJiraTrigger(project.id, { event: 'assigned' })
    await deliver(updated(project, [{ field: 'assignee', from: null, to: 'someone-else' }]))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, [{ field: 'assignee', from: null, to: KNECHT_ACCOUNT }], { assignee: { accountId: KNECHT_ACCOUNT, displayName: 'Knecht' } }))
    const [run] = runsOf(trigger.id)
    expect(run!.inputs).toMatchObject({ assignee: 'Knecht' })
  })

  it('applies the issue type filter', async () => {
    const project = makeJiraProject()
    const trigger = makeJiraTrigger(project.id, { event: 'created', issueType: 'Task' })
    await deliver({ webhookEvent: 'jira:issue_created', issue: issue(project) })
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver({ webhookEvent: 'jira:issue_created', issue: issue(project, { issuetype: { name: 'Task' } }) })
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('mirrors done, reopened and deleted onto the session', async () => {
    const project = makeJiraProject()
    const key = `${project.jiraProjectKey}-12`
    const session = resolveSession(project, { integration: 'jira', kind: 'issue', key }, null)

    await deliver(updated(project, [{ field: 'status', fromString: 'To Do', toString: 'Done' }], { status: { name: 'Done', statusCategory: { key: 'done' } } }))
    expect(getSessionRow(session.id).status).toBe('closed')

    await deliver(updated(project, [{ field: 'status', fromString: 'Done', toString: 'To Do' }]))
    expect(getSessionRow(session.id).status).toBe('open')

    await deliver({ webhookEvent: 'jira:issue_deleted', issue: issue(project) })
    expect(getSessionRow(session.id).status).toBe('closed')
  })

  it('turns a comment mentioning the connection account into a follow-up', async () => {
    const project = makeJiraProject()
    api.fetched = {
      id: '77',
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [
          { type: 'mention', attrs: { id: KNECHT_ACCOUNT, text: '@Knecht' } },
          { type: 'text', text: ' please fix the login' },
        ] }],
      },
      author: { accountId: 'user-1', displayName: 'Ann Example' },
    }
    const res = await deliver({ webhookEvent: 'comment_created', issue: issue(project), comment: { id: 77 } })
    expect(res.json).toMatchObject({ outcome: expect.stringContaining('setup hint') })
    expect(api.comments.at(-1)?.key).toBe(`${project.jiraProjectKey}-12`)
    expect(getSessionRow(resolveSession(project, { integration: 'jira', kind: 'issue', key: `${project.jiraProjectKey}-12` }, null).id).objectIntegration).toBe('jira')
  })

  it('accepts the plain @knecht text as a mention', async () => {
    const project = makeJiraProject()
    api.fetched = { id: '78', body: doc('@knecht have a look'), author: { accountId: 'user-2', displayName: 'Bob' } }
    const res = await deliver({ webhookEvent: 'comment_created', issue: issue(project), comment: { id: 78 } })
    expect(res.json).toMatchObject({ outcome: expect.stringContaining('setup hint') })
  })

  it('ignores comments by the connection account and comments without a mention', async () => {
    const project = makeJiraProject()
    api.fetched = { id: '79', body: doc('@knecht I am Knecht'), author: { accountId: KNECHT_ACCOUNT, displayName: 'Knecht' } }
    expect((await deliver({ webhookEvent: 'comment_created', issue: issue(project), comment: { id: 79 } })).json)
      .toMatchObject({ outcome: expect.stringContaining('Knecht itself') })
    api.fetched = { id: '80', body: doc('just chatting'), author: { accountId: 'user-1', displayName: 'Ann Example' } }
    expect((await deliver({ webhookEvent: 'comment_created', issue: issue(project), comment: { id: 80 } })).json)
      .toMatchObject({ outcome: expect.stringContaining('no mention') })
  })
})
