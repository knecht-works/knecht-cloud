import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import type { TriggerEventConfig } from '../../shared/utils/trigger-form'
import { getSessionRow, makeProject } from '../helpers/db'
import { describeIntegrationWebhook, makeTrigger, runsOf, type WebhookRequest } from '../helpers/integration-webhook-suite'
import { allOf } from '../helpers/trigger-conditions'

const api = vi.hoisted(() => ({
  comments: [] as { key: string, body: unknown }[],
  statusCategories: {} as Record<string, string>,
  fetched: {
    id: '77',
    body: null as unknown,
    author: { accountId: 'user-1', displayName: 'Ann Example' },
  },
}))
vi.mock('../../server/integrations/jira/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/jira/api')>(),
  getJiraComment: async () => api.fetched,
  getJiraIssueFields: async () => ({ reporter: { accountId: 'user-1', displayName: 'Ann Example' } }),
  getJiraStatusCategory: async (id: string) => api.statusCategories[id] ?? null,
  addJiraComment: async (key: string, body: unknown) => {
    api.comments.push({ key, body })
    return { url: `https://acme.atlassian.net/browse/${key}` }
  },
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { jira } = await import('../../server/integrations/jira')
const { jiraConnection, jiraCredentials } = await import('../../server/integrations/jira/credentials')
const { resolveSession } = await import('../../server/utils/sessions')
const { setProjectLink } = await import('../../server/utils/project-links')
const handler = (await import('../../server/api/jira/webhook.post')).default

const KNECHT_ACCOUNT = 'knecht-account-id'

function request(payload: object, secret = jiraCredentials()?.webhookSecret ?? ''): WebhookRequest {
  const body = JSON.stringify(payload)
  return { body, headers: { 'x-hub-signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` } }
}

function deliver(payload: object) {
  return callRoute(handler, request(payload))
}

let keyN = 0
function makeJiraProject() {
  const project = makeProject()
  const jiraProjectKey = `P${++keyN}`
  setProjectLink(project.id, 'jira', jiraProjectKey)
  return { ...project, jiraProjectKey }
}
type JiraProject = ReturnType<typeof makeJiraProject>

function makeJiraTrigger(projectId: number, on: TriggerEventConfig[], fields: Record<string, string[]> = {}) {
  return makeTrigger('jira', [projectId], { kind: 'issue', on, conditions: allOf(fields) })
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

function commented(project: JiraProject, fetched: typeof api.fetched) {
  api.fetched = fetched
  return { webhookEvent: 'comment_created', issue: issue(project), comment: { id: Number(fetched.id) } }
}

describeIntegrationWebhook<JiraProject, object>({
  integration: jira,
  handler,
  configure: () => jiraConnection.save({ siteUrl: 'https://acme.atlassian.net', email: 'knecht@acme.test', apiToken: 't' }, { accountName: 'Knecht', accountId: KNECHT_ACCOUNT }),
  request,
  makeProject: makeJiraProject,
  unknownProject: () => ({ webhookEvent: 'jira:issue_created', issue: issue({ jiraProjectKey: 'NOPE' }) }),
  object: project => ({ integration: 'jira', kind: 'issue', key: `${project.jiraProjectKey}-12` }),
  created: {
    config: { kind: 'issue', on: [{ type: 'created' }], conditions: [] },
    delivery: project => ({ webhookEvent: 'jira:issue_created', issue: issue(project) }),
    run: project => ({
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
    }),
    session: project => ({
      objectIntegration: 'jira',
      objectKind: 'issue',
      objectKey: `${project.jiraProjectKey}-12`,
      objectTitle: 'Login broken',
      objectUrl: `https://acme.atlassian.net/browse/${project.jiraProjectKey}-12`,
    }),
  },
  labeled: {
    config: { kind: 'issue', on: [{ type: 'labeled', values: ['knecht'] }], conditions: [] },
    notGained: project => [
      updated(project, [{ field: 'labels', fromString: 'knecht', toString: 'knecht bug' }]),
      updated(project, [{ field: 'labels', fromString: '', toString: 'other' }]),
    ],
    gained: project => updated(project, [{ field: 'labels', fromString: 'bug', toString: 'bug knecht' }]),
  },
  filters: [{
    config: { kind: 'issue', on: [{ type: 'created' }], conditions: [] },
    delivery: project => ({ webhookEvent: 'jira:issue_created', issue: issue(project, { assignee: { accountId: KNECHT_ACCOUNT } }) }),
    values: { status: 'To Do', assignee: 'self', label: 'bug', issueType: 'Bug' },
  }],
  closed: project => updated(project, [{ field: 'status', fromString: 'To Do', toString: 'Done' }], { status: { name: 'Done', statusCategory: { key: 'done' } } }),
  reopened: project => updated(project, [{ field: 'status', fromString: 'Done', toString: 'To Do' }]),
  comment: {
    mention: project => commented(project, {
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
    }),
    fromSelf: project => commented(project, { id: '79', body: doc('@knecht I am Knecht'), author: { accountId: KNECHT_ACCOUNT, displayName: 'Knecht' } }),
    withoutMention: project => commented(project, { id: '80', body: doc('just chatting'), author: { accountId: 'user-1', displayName: 'Ann Example' } }),
    replyCount: project => api.comments.filter(c => c.key === `${project.jiraProjectKey}-12`).length,
  },
  recorded: {
    status: jiraConnection.status,
    createdSummary: project => `jira:issue_created ${project.jiraProjectKey}-12`,
  },
})

describe('jira webhook route, vendor specifics', () => {
  it('fires on a ticket created with the label or the assignment already set, not in the status', async () => {
    const project = makeJiraProject()
    const labeled = makeJiraTrigger(project.id, [{ type: 'labeled', values: ['knecht'] }])
    const transitioned = makeJiraTrigger(project.id, [{ type: 'status', values: ['In Progress'] }])
    const assigned = makeJiraTrigger(project.id, [{ type: 'assigned' }])

    await deliver({ webhookEvent: 'jira:issue_created', issue: issue(project, { labels: ['bug'] }) })
    expect(runsOf(labeled.id)).toHaveLength(0)
    expect(runsOf(transitioned.id)).toHaveLength(0)
    expect(runsOf(assigned.id)).toHaveLength(0)

    await deliver({ webhookEvent: 'jira:issue_created', issue: issue(project, {
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      assignee: { accountId: KNECHT_ACCOUNT, displayName: 'Knecht' },
    }) })
    expect(runsOf(labeled.id)).toHaveLength(1)
    expect(runsOf(transitioned.id)).toHaveLength(0)
    expect(runsOf(assigned.id)).toHaveLength(1)
  })

  it('fires on a transition to the configured status', async () => {
    const project = makeJiraProject()
    const trigger = makeJiraTrigger(project.id, [{ type: 'status', values: ['In Progress'] }])
    await deliver(updated(project, [{ field: 'status', fromString: 'To Do', toString: 'Done' }]))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }]))
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires on a transition into the configured status category, whatever the status is called', async () => {
    const project = makeJiraProject()
    const trigger = makeJiraTrigger(project.id, [{ type: 'status', values: ['category:done'] }])
    api.statusCategories = { 1: 'new', 2: 'indeterminate', 3: 'done', 4: 'done' }

    await deliver(updated(project, [{ field: 'status', from: '1', to: '2', fromString: 'To Do', toString: 'In Progress' }], { status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, [{ field: 'status', from: '2', to: '4', fromString: 'In Progress', toString: 'Released' }], { status: { name: 'Released', statusCategory: { key: 'done' } } }))
    expect(runsOf(trigger.id)).toHaveLength(1)
    await deliver(updated(project, [{ field: 'status', from: '4', to: '3', fromString: 'Released', toString: 'Done' }], { status: { name: 'Done', statusCategory: { key: 'done' } } }))
    expect(runsOf(trigger.id)).toHaveLength(1)

    await deliver({ webhookEvent: 'jira:issue_created', issue: issue(project, { status: { name: 'Closed', statusCategory: { key: 'done' } } }) })
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires when the ticket is assigned to the connection account', async () => {
    const project = makeJiraProject()
    const trigger = makeJiraTrigger(project.id, [{ type: 'assigned' }])
    await deliver(updated(project, [{ field: 'assignee', from: null, to: 'someone-else' }]))
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver(updated(project, [{ field: 'assignee', from: null, to: KNECHT_ACCOUNT }], { assignee: { accountId: KNECHT_ACCOUNT, displayName: 'Knecht' } }))
    const [run] = runsOf(trigger.id)
    expect(run!.inputs).toMatchObject({ assignee: 'Knecht' })
  })

  it('records who assigned the ticket on the run, and does not count Knecht taking it itself', async () => {
    const project = makeJiraProject()
    const trigger = makeJiraTrigger(project.id, [{ type: 'assigned' }])
    const assigned = { assignee: { accountId: KNECHT_ACCOUNT, displayName: 'Knecht' } }
    await deliver({ ...updated(project, [{ field: 'assignee', from: null, to: KNECHT_ACCOUNT }], assigned), user: { accountId: KNECHT_ACCOUNT, displayName: 'Knecht' } })
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver({ ...updated(project, [{ field: 'assignee', from: null, to: KNECHT_ACCOUNT }], assigned), user: { accountId: 'user-2', displayName: 'Bob' } })
    expect(runsOf(trigger.id)[0]).toMatchObject({ actor: { id: 'user-2', name: 'Bob' } })
  })

  // A triage workflow labels the ticket and moves it, and the next workflow picks it up from there.
  it('a label or status the agent sets itself starts the next workflow, without Knecht as the actor', async () => {
    const project = makeJiraProject()
    const trigger = makeJiraTrigger(project.id, [{ type: 'status', values: ['To Do'] }], { label: ['enhancement'] })
    await deliver({
      ...updated(project, [{ field: 'status', from: '1', fromString: 'Triage', toString: 'To Do' }], { labels: ['enhancement'], status: { name: 'To Do', statusCategory: { key: 'new' } } }),
      user: { accountId: KNECHT_ACCOUNT, displayName: 'Knecht' },
    })
    expect(runsOf(trigger.id)).toHaveLength(1)
    expect(runsOf(trigger.id)[0]!.actor).toBeNull()
  })

  it('applies the issue type filter', async () => {
    const project = makeJiraProject()
    const trigger = makeJiraTrigger(project.id, [{ type: 'created' }], { issueType: ['Task'] })
    await deliver({ webhookEvent: 'jira:issue_created', issue: issue(project) })
    expect(runsOf(trigger.id)).toHaveLength(0)
    await deliver({ webhookEvent: 'jira:issue_created', issue: issue(project, { issuetype: { name: 'Task' } }) })
    expect(runsOf(trigger.id)).toHaveLength(1)
  })

  it('fires on any of several events and only for tickets carrying the label filter', async () => {
    const project = makeJiraProject()
    const either = makeJiraTrigger(project.id, [{ type: 'assigned' }, { type: 'status', values: ['In Progress'] }])
    const backendOnly = makeJiraTrigger(project.id, [{ type: 'created' }], { label: ['backend'] })

    await deliver(updated(project, [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }]))
    await deliver(updated(project, [{ field: 'assignee', to: KNECHT_ACCOUNT }]))
    await deliver(updated(project, [{ field: 'summary', toString: 'Renamed' }]))
    expect(runsOf(either.id)).toHaveLength(2)

    await deliver({ webhookEvent: 'jira:issue_created', issue: issue(project) })
    expect(runsOf(backendOnly.id)).toHaveLength(0)
    await deliver({ webhookEvent: 'jira:issue_created', issue: issue(project, { labels: ['backend'] }) })
    expect(runsOf(backendOnly.id)).toHaveLength(1)
  })

  it('closes the session of a deleted ticket', async () => {
    const project = makeJiraProject()
    const session = resolveSession(project, { integration: 'jira', kind: 'issue', key: `${project.jiraProjectKey}-12` }, null)
    await deliver({ webhookEvent: 'jira:issue_deleted', issue: issue(project) })
    expect(getSessionRow(session.id).status).toBe('closed')
  })

  it('accepts the plain @knecht text as a mention', async () => {
    const project = makeJiraProject()
    const res = await deliver(commented(project, { id: '78', body: doc('@knecht have a look'), author: { accountId: 'user-2', displayName: 'Bob' } }))
    expect(res.json).toMatchObject({ outcome: expect.stringContaining('setup hint') })
  })
})
