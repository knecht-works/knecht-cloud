import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { makeProject, makeRun } from '../helpers/db'

const comments: { issue: number, body: string }[] = []
const labels: { added: string[], removed: string[] } = { added: [], removed: [] }
vi.mock('../../server/utils/github-app', () => ({
  getInstallationToken: async () => 'test-token',
  createIssueComment: async (_o: string, _r: string, issue: number, body: string) => {
    comments.push({ issue, body })
    return { url: 'https://x/comment/1' }
  },
  listRepoLabels: async () => ['bug', 'help wanted'],
  addIssueLabels: async (_o: string, _r: string, _n: number, names: string[]) => {
    labels.added.push(...names)
  },
  removeIssueLabel: async (_o: string, _r: string, _n: number, name: string) => {
    labels.removed.push(name)
  },
  createPullRequest: async () => null,
  getIssueSnapshot: async (_o: string, _r: string, n: number) => ({
    issue: {
      number: n,
      title: 'Broken build',
      html_url: `https://github.com/acme/app/issues/${n}`,
      state: 'open',
      user: { login: 'ann' },
      labels: [{ name: 'bug' }],
      assignees: [],
      body: 'It fails.\n\n<img src="https://github.com/user-attachments/assets/aaaaaaaa-1111-2222-3333-444444444444" />',
      body_html: '<p>It fails.</p><img src="https://private-user-images.githubusercontent.com/1/9-aaaaaaaa-1111-2222-3333-444444444444.png?jwt=x&amp;y=1">',
    },
    comments: [{ user: { login: 'bob' }, created_at: '2026-11-06T10:00:00Z', body: 'Log attached', body_html: '<a href="https://github.com/user-attachments/files/77/build.log">build.log</a>' }],
    pull: null,
    reviews: [],
    reviewComments: [],
    parent: null,
    subIssues: [{ number: 8, title: 'Pin node' }],
  }),
  downloadGithubUpload: async (url: string) => {
    if (url.includes('/files/')) throw new Error('404')
    return Buffer.from(url.includes('jwt=x&y=1') ? 'png' : 'wrong')
  },
}))
const jiraApi = vi.hoisted(() => ({
  comments: [] as { key: string, body: unknown, parentId?: string | null }[],
  labels: [] as { key: string, add: string[], remove: string[] }[],
  transitions: [] as { key: string, id: string }[],
}))
vi.mock('../../server/integrations/jira/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/jira/api')>(),
  addJiraComment: async (key: string, body: unknown, parentId?: string | null) => {
    jiraApi.comments.push({ key, body, parentId })
    return { url: `https://acme.atlassian.net/browse/${key}?focusedCommentId=1` }
  },
  updateJiraLabels: async (key: string, add: string[], remove: string[]) => {
    jiraApi.labels.push({ key, add, remove })
  },
  listJiraLabels: async () => ['backend', 'old'],
  listJiraTransitions: async () => [{ id: '11', to: 'In Progress' }, { id: '21', to: 'In Review' }],
  transitionJiraIssue: async (key: string, id: string) => {
    jiraApi.transitions.push({ key, id })
  },
  getJiraIssueFields: async () => ({ summary: 'Login broken', status: { name: 'To Do' } }),
  getJiraIssueRaw: async (key: string) => ({
    key,
    fields: {
      summary: 'Login broken',
      status: { name: 'To Do' },
      issuetype: { name: 'Bug' },
      attachment: [
        { id: '10', filename: 'login error.png', mimeType: 'image/png', size: 3 },
        { id: '11', filename: 'dump.sql', mimeType: 'application/sql', size: 50 * 1024 * 1024 },
      ],
      parent: { key: 'PROJ-0', fields: { summary: 'Auth epic' } },
      issuelinks: [{ type: { inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'PROJ-7', fields: { summary: 'Session store' } } }],
    },
  }),
  listJiraIssueComments: async () => [{ id: '1', body: { type: 'doc', content: [] } }],
  downloadJiraAttachment: async () => Buffer.from('png'),
}))

vi.mock('../../server/integrations/linear/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/linear/api')>(),
  getLinearIssueRaw: async (id: string) => ({
    identifier: id,
    title: 'Footer missing',
    description: 'See ![footer.png](https://uploads.linear.app/a/b/c)',
    url: `https://linear.app/acme/issue/${id}`,
    priorityLabel: 'High',
    state: { name: 'Todo' },
    assignee: null,
    parent: { identifier: 'CRA-1', title: 'Layout' },
    children: { nodes: [{ identifier: 'CRA-3', title: 'Imprint link' }] },
    relations: { nodes: [{ type: 'blocks', relatedIssue: { identifier: 'CRA-4', title: 'Launch' } }] },
    inverseRelations: { nodes: [{ type: 'blocks', issue: { identifier: 'CRA-5', title: 'Design' } }] },
    comments: { nodes: [{ body: 'Also [log.txt](https://uploads.linear.app/a/b/d)' }] },
  }),
  downloadLinearUpload: async (url: string) => Buffer.from(url.endsWith('/c') ? 'png' : 'log'),
}))
vi.mock('../../server/integrations/plane/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/plane/api')>(),
  planeProjectByIdentifier: async (identifier: string) => ({ id: 'p1', identifier, name: identifier }),
  getPlaneWorkItemByKey: async () => ({ id: 'w2', sequence_id: 2, name: 'Dark mode' }),
  getPlaneWorkItemRaw: async () => ({
    name: 'Dark mode',
    description_html: '<image-component src="11111111-1111-1111-1111-111111111111" status="uploaded"></image-component><p>Make it dark.</p>',
    priority: 'high',
    parent: { id: 'w1' },
    state: { name: 'In Review' },
    assignees: [{ first_name: 'Ann' }],
  }),
  listPlaneComments: async () => [{ id: 'c1', comment_html: '<p>hi</p><image-component src="22222222-2222-2222-2222-222222222222"></image-component>', actor: 'u1' }],
  downloadPlaneAsset: async (id: string) => ({ content: Buffer.from('png'), name: id.startsWith('1') ? 'mockup.png' : 'error.png', type: 'image/png' }),
  listPlaneAttachments: async () => [
    { id: 'a1', attributes: { name: 'mock.png', size: 3, type: 'image/png' }, is_uploaded: true },
    { id: 'a2', attributes: { name: 'half.png', size: 3, type: 'image/png' }, is_uploaded: false },
  ],
  getPlaneRelations: async () => ({ blocked_by: ['w3'], relates_to: ['elsewhere'] }),
  listPlaneLinks: async () => [],
  listPlaneWorkItems: async () => [
    { id: 'w1', sequence_id: 1, name: 'Theming', parent: null },
    { id: 'w2', sequence_id: 2, name: 'Dark mode', parent: 'w1' },
    { id: 'w3', sequence_id: 3, name: 'Tokens', parent: null },
    { id: 'w4', sequence_id: 4, name: 'Toggle', parent: 'w2' },
  ],
  listPlaneMembers: async () => [{ id: 'u1', displayName: 'Ann' }],
  downloadPlaneAttachment: async () => Buffer.from('png'),
}))
// The bridge writes through the session's container; here that is the checkout itself.
vi.mock('../../server/daemon/session-sandbox', async () => {
  const { execa } = await import('execa')
  const { sessionCheckoutDir } = await import('../../server/utils/storage')
  return {
    sessionSandbox: (sessionId: number) => ({
      exec: async ([cmd, ...args]: string[], opts?: { input?: string | Uint8Array }) => (await execa(cmd!, args, { cwd: sessionCheckoutDir(sessionId), input: opts?.input })).stdout,
    }),
  }
})

const { db, schema } = await import('../../server/db')
const { bridgeToken } = await import('../../server/utils/agent-bridge')
const { sessionCheckoutDir } = await import('../../server/utils/storage')
const { setProjectLink } = await import('../../server/stores/project-links')
const handler = (await import('../../server/routes/agent-bridge.post')).default

function call(sessionId: number, body: object, token = bridgeToken(sessionId)) {
  return callRoute(handler, { body, headers: { 'x-knecht-run-id': String(sessionId), 'x-knecht-token': token } })
}

function bindObject(sessionId: number, kind: 'issue' | 'pull_request' = 'issue', number = 5) {
  db.update(schema.sessions).set({ objectIntegration: 'github', objectKind: kind, objectKey: String(number) }).where(eq(schema.sessions.id, sessionId)).run()
}

function objectSession(overrides: Parameters<typeof makeRun>[2] = {}) {
  const project = makeProject()
  const run = makeRun(project, [], { status: 'success', ...overrides })
  mkdirSync(join(sessionCheckoutDir(run.sessionId), '.git'), { recursive: true })
  bindObject(run.sessionId)
  return { project, run, sessionId: run.sessionId }
}

function ticketSession(integration: 'jira' | 'linear' | 'plane' = 'jira', key = 'PROJ-1') {
  const project = makeProject()
  const run = makeRun(project, [], { status: 'success' })
  mkdirSync(join(sessionCheckoutDir(run.sessionId), '.git'), { recursive: true })
  db.update(schema.sessions).set({ objectIntegration: integration, objectKind: 'issue', objectKey: key }).where(eq(schema.sessions.id, run.sessionId)).run()
  return { project, run, sessionId: run.sessionId }
}

describe('agent bridge', () => {
  it('rejects a bad token and an unknown session', async () => {
    const { sessionId } = objectSession()
    expect((await call(sessionId, { op: 'comment', body: 'hi' }, 'nope')).status).toBe(401)
    expect((await call(999_999, { op: 'comment', body: 'hi' })).status).toBe(404)
  })

  it('refuses a session without a checkout', async () => {
    const run = makeRun(makeProject(), [])
    const res = await call(run.sessionId, { op: 'comment', body: 'hi' })
    expect(res.status).toBe(409)
    expect(res.text).toContain('no checkout')
  })

  it('rejects an unknown op', async () => {
    const { sessionId } = objectSession()
    const res = await call(sessionId, { op: 'assign', to: 'me' })
    expect(res.status).toBe(400)
    expect(res.text).toContain('invalid request')
  })

  it('refuses a status change where the integration has no statuses', async () => {
    const { sessionId } = objectSession()
    const res = await call(sessionId, { op: 'status', status: 'Done' })
    expect(res.status).toBe(400)
    expect(res.text).toContain('not supported for issue #5')
  })

  it('refuses to comment on a session that has no object', async () => {
    const run = makeRun(makeProject(), [])
    mkdirSync(join(sessionCheckoutDir(run.sessionId), '.git'), { recursive: true })
    const res = await call(run.sessionId, { op: 'comment', body: 'hi' })
    expect(res.status).toBe(400)
    expect(res.text).toContain('does not belong to a ticket, issue or pull request')
  })

  it('posts a comment on the object and records the reply', async () => {
    const { sessionId, run } = objectSession()
    const res = await call(sessionId, { op: 'comment', body: 'All done.' })
    expect(res.status).toBe(200)
    expect(res.text).toBe('posted the reply on issue #5: https://x/comment/1\n')
    expect(comments.at(-1)).toEqual({ issue: 5, body: 'All done.' })
    const log = db.select({ log: schema.runs.log }).from(schema.runs).where(eq(schema.runs.id, run.id)).get()!.log
    expect(log).toContain('agent-reply: commented on issue #5')
  })

  it('refuses replies while a workflow with replies disabled is running', async () => {
    const wf = db.insert(schema.workflows).values({ name: 'silent', steps: [], repliesEnabled: false }).returning().get()
    const { sessionId } = objectSession({ status: 'running', workflowId: wf.id })
    const res = await call(sessionId, { op: 'comment', body: 'hi' })
    expect(res.status).toBe(400)
    expect(res.text).toContain('disabled for this workflow')
  })

  it('hands the agent the current state of the object', async () => {
    const { sessionId } = objectSession()
    const res = await call(sessionId, { op: 'context' })
    expect(res.status).toBe(200)
    expect(res.text).toContain('# Issue #5: Broken build\nhttps://github.com/acme/app/issues/5\nopen · by ann · labels bug\n')
    expect(res.text).toContain('- .knecht/objects/5/attachments/aaaaaaaa-1111-2222-3333-444444444444.png (image/png, 1 KB)')
    expect(res.text).toContain('- build.log not downloaded: GitHub serves a file uploaded to a private repository only to a signed-in browser')
    expect(res.text).toContain('- #8 (sub-issue): Pin node')
    expect(res.text).toContain('### bob · 2026-11-06T10:00:00Z\n\nLog attached')
    expect(readFileSync(join(sessionCheckoutDir(sessionId), '.knecht', 'objects', '5', 'attachments', 'aaaaaaaa-1111-2222-3333-444444444444.png'), 'utf8')).toBe('png')

    const bare = makeRun(makeProject(), [])
    mkdirSync(join(sessionCheckoutDir(bare.sessionId), '.git'), { recursive: true })
    expect((await call(bare.sessionId, { op: 'context' })).status).toBe(400)
  })

  it('applies only existing labels and removes labels', async () => {
    const { sessionId } = objectSession()
    const unknown = await call(sessionId, { op: 'label', add: ['nope'] })
    expect(unknown.status).toBe(400)
    expect(unknown.text).toContain('do not exist and Knecht never creates labels: nope. Existing labels: bug, help wanted')

    const empty = await call(sessionId, { op: 'label' })
    expect(empty.status).toBe(400)

    const res = await call(sessionId, { op: 'label', add: ['bug'], remove: ['help wanted'] })
    expect(res.status).toBe(200)
    expect(res.text).toBe('added bug; removed help wanted on issue #5\n')
    expect(labels).toEqual({ added: ['bug'], removed: ['help wanted'] })
  })
})

describe('agent bridge on a Jira ticket', () => {
  it('writes the raw ticket and its attachments into the checkout and answers an index', async () => {
    const { sessionId } = ticketSession()
    const res = await call(sessionId, { op: 'context' })
    expect(res.status).toBe(200)
    expect(res.text).toContain('# PROJ-1: Login broken\n/browse/PROJ-1\nBug · To Do\n')
    expect(res.text).toContain(': .knecht/objects/PROJ-1/ticket.json')
    expect(res.text).toContain('- .knecht/objects/PROJ-1/attachments/login_error.png (image/png, 1 KB)')
    expect(res.text).toContain('- dump.sql (50.0 MB) not downloaded: over the 20.0 MB limit')
    expect(res.text).toContain('- PROJ-0 (parent): Auth epic\n- PROJ-7 (is blocked by): Session store')

    const dir = join(sessionCheckoutDir(sessionId), '.knecht', 'objects', 'PROJ-1')
    expect(JSON.parse(readFileSync(join(dir, 'ticket.json'), 'utf8'))).toMatchObject({ key: 'PROJ-1', comments: [{ id: '1' }] })
    expect(readFileSync(join(dir, 'attachments', 'login_error.png'), 'utf8')).toBe('png')
    expect(readFileSync(join(dir, 'ticket.md'), 'utf8')).toContain('# PROJ-1: Login broken\n')
    expect(res.text).toContain('This index is saved as .knecht/objects/PROJ-1/ticket.md.')
  })

  it('loads a ticket of a linked project by key and refuses any other', async () => {
    const { project, sessionId } = ticketSession()
    setProjectLink(project.id, 'jira', 'PROJ')
    const linked = await call(sessionId, { op: 'context', key: 'PROJ-7' })
    expect(linked.status).toBe(200)
    expect(linked.text).toContain('.knecht/objects/PROJ-7/ticket.json')

    const foreign = await call(sessionId, { op: 'context', key: 'OTHER-1' })
    expect(foreign.status).toBe(400)
    expect(foreign.text).toContain('OTHER-1 is not in a Jira project linked to this Knecht project')
  })

  it('posts the comment as ADF', async () => {
    const { sessionId } = ticketSession()
    const res = await call(sessionId, { op: 'comment', body: 'Done, see `auth.php`.' })
    expect(res.status).toBe(200)
    expect(res.text).toBe('posted the reply on ticket PROJ-1: https://acme.atlassian.net/browse/PROJ-1?focusedCommentId=1\n')
    expect(jiraApi.comments.at(-1)).toMatchObject({ key: 'PROJ-1', body: { type: 'doc' } })
  })

  it('addresses whoever gave Knecht the ticket when the agent comments during a run', async () => {
    const { sessionId } = ticketSession()
    db.update(schema.runs).set({ status: 'running', actor: { id: 'user-2', name: 'Bob' } }).where(eq(schema.runs.sessionId, sessionId)).run()
    await call(sessionId, { op: 'comment', body: 'Here is my plan.' })
    expect(jiraApi.comments.at(-1)).toMatchObject({ parentId: null })
    expect((jiraApi.comments.at(-1)!.body as { content: { content: unknown[] }[] }).content[0]!.content[0]).toEqual({ type: 'mention', attrs: { id: 'user-2', text: '@Bob' } })
  })

  it('answers a mention in its thread and addresses whoever asked', async () => {
    const { run, sessionId } = ticketSession()
    db.insert(schema.followups).values({
      sessionId,
      runId: run.id,
      prompt: '@Knecht fix it',
      origin: 'mention',
      status: 'running',
      replyTo: { thread: '10398', person: { id: 'user-1', name: 'Ann Example' } },
    }).run()
    await call(sessionId, { op: 'comment', body: 'Fixed.' })
    expect(jiraApi.comments.at(-1)).toMatchObject({
      parentId: '10398',
      body: { content: [{ type: 'paragraph', content: [
        { type: 'mention', attrs: { id: 'user-1', text: '@Ann Example' } },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'Fixed.' },
      ] }] },
    })

    await call(sessionId, { op: 'comment', body: 'PR is up.', newThread: true })
    expect(jiraApi.comments.at(-1)).toMatchObject({
      parentId: null,
      body: { content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'user-1' } }, { type: 'text', text: ' ' }, { type: 'text', text: 'PR is up.' }] }] },
    })
  })

  it('applies only labels that exist in Jira', async () => {
    const { sessionId } = ticketSession()
    const invented = await call(sessionId, { op: 'label', add: ['anything'] })
    expect(invented.status).toBe(400)
    expect(invented.text).toContain('Knecht never creates labels: anything. Existing labels: backend, old')
    expect(jiraApi.labels).toEqual([])

    const res = await call(sessionId, { op: 'label', add: ['backend'], remove: ['old'] })
    expect(res.status).toBe(200)
    expect(res.text).toBe('added backend; removed old on ticket PROJ-1\n')
    expect(jiraApi.labels.at(-1)).toEqual({ key: 'PROJ-1', add: ['backend'], remove: ['old'] })
  })

  it('moves the ticket through the transition whose target matches the status', async () => {
    const { sessionId, run } = ticketSession()
    const res = await call(sessionId, { op: 'status', status: 'in review' })
    expect(res.status).toBe(200)
    expect(res.text).toBe('moved to "In Review" on ticket PROJ-1\n')
    expect(jiraApi.transitions.at(-1)).toEqual({ key: 'PROJ-1', id: '21' })
    const log = db.select({ log: schema.runs.log }).from(schema.runs).where(eq(schema.runs.id, run.id)).get()!.log
    expect(log).toContain('agent-status: moved to "In Review" on ticket PROJ-1')

    const unknown = await call(sessionId, { op: 'status', status: 'Shipped' })
    expect(unknown.status).toBe(400)
    expect(unknown.text).toContain('Reachable: In Progress, In Review')
  })
})

describe('agent bridge on a Linear issue', () => {
  it('writes the raw issue, its uploads and the linked issues', async () => {
    const { sessionId } = ticketSession('linear', 'CRA-2')
    const res = await call(sessionId, { op: 'context' })
    expect(res.status).toBe(200)
    expect(res.text).toContain('# CRA-2: Footer missing\nhttps://linear.app/acme/issue/CRA-2\nTodo · High\n')
    expect(res.text).toContain('- .knecht/objects/CRA-2/attachments/footer.png (unknown type, 1 KB)')
    expect(res.text).toContain('- .knecht/objects/CRA-2/attachments/log.txt (unknown type, 1 KB)')
    expect(res.text).toContain('- CRA-1 (parent): Layout\n- CRA-3 (sub-issue): Imprint link\n- CRA-4 (blocks): Launch\n- CRA-5 (blocked by): Design')
    const dir = join(sessionCheckoutDir(sessionId), '.knecht', 'objects', 'CRA-2')
    expect(JSON.parse(readFileSync(join(dir, 'ticket.json'), 'utf8'))).toMatchObject({ identifier: 'CRA-2', priorityLabel: 'High' })
  })

  it('loads an issue of a linked team by key and refuses any other', async () => {
    const { project, sessionId } = ticketSession('linear', 'CRA-2')
    setProjectLink(project.id, 'linear', 'CRA')
    expect((await call(sessionId, { op: 'context', key: 'CRA-4' })).text).toContain('# CRA-4: ')
    expect((await call(sessionId, { op: 'context', key: 'ENG-1' })).status).toBe(400)
  })
})

describe('agent bridge on a Plane work item', () => {
  it('writes the raw work item, its uploaded attachments and the linked work items', async () => {
    const { sessionId } = ticketSession('plane', 'CRAFT-2')
    const res = await call(sessionId, { op: 'context' })
    expect(res.status).toBe(200)
    expect(res.text).toContain('# CRAFT-2: Dark mode\n')
    expect(res.text).toContain('In Review · priority high · assigned to Ann')
    expect(res.text).toContain('- .knecht/objects/CRAFT-2/attachments/mock.png (image/png, 1 KB)')
    expect(res.text).not.toContain('half.png')
    expect(res.text).toContain('- .knecht/objects/CRAFT-2/attachments/mockup.png (image/png, 1 KB)')
    expect(res.text).toContain('- .knecht/objects/CRAFT-2/attachments/error.png (image/png, 1 KB)')
    expect(res.text).toContain('- CRAFT-1 (parent): Theming\n- CRAFT-4 (sub-work item): Toggle\n- CRAFT-3 (blocked by): Tokens')
    const dir = join(sessionCheckoutDir(sessionId), '.knecht', 'objects', 'CRAFT-2')
    expect(JSON.parse(readFileSync(join(dir, 'ticket.json'), 'utf8'))).toMatchObject({ name: 'Dark mode', comments: [{ id: 'c1' }], relations: { relates_to: ['elsewhere'] } })
  })

  it('loads a work item of a linked project by key and refuses any other', async () => {
    const { project, sessionId } = ticketSession('plane', 'CRAFT-2')
    setProjectLink(project.id, 'plane', 'CRAFT')
    expect((await call(sessionId, { op: 'context', key: 'CRAFT-3' })).status).toBe(200)
    expect((await call(sessionId, { op: 'context', key: 'OTHER-1' })).status).toBe(400)
  })
})
