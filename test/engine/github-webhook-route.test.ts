import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { callRoute } from '../helpers/routes'
import { getSessionRow, makeProject } from '../helpers/db'

const comments: { issue: number, body: string }[] = []
vi.mock('../../server/utils/github-app', () => ({
  addCommentReaction: async () => {},
  createIssueComment: async (_o: string, _r: string, issue: number, body: string) => {
    comments.push({ issue, body })
    return { url: 'https://x/comment' }
  },
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { db, schema } = await import('../../server/db')
const { saveGithubAppCredentials } = await import('../../server/utils/github-credentials')
const { resolveSession } = await import('../../server/utils/sessions')
const handler = (await import('../../server/api/github/webhook.post')).default

const SECRET = 'whsec-test'

function deliver(event: string, payload: object, secret = SECRET) {
  const raw = JSON.stringify(payload)
  return callRoute(handler, {
    body: raw,
    headers: {
      'x-github-event': event,
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
    },
  })
}

let n = 0
function makeWorkflow() {
  return db.insert(schema.workflows).values({
    name: `webhook-route-${++n}`,
    steps: [{ type: 'bash', command: 'true', id: 'run' }],
    publishedAt: new Date(),
  }).returning().get()
}

interface GithubTriggerOpts {
  event?: 'push' | 'pull_request' | 'issues'
  branches?: string[]
  issueActions?: ('opened' | 'labeled')[]
  issueLabel?: string | null
  active?: boolean
}

function makeGithubTrigger(projectIds: number[], opts: GithubTriggerOpts = {}) {
  return db.insert(schema.triggers).values({
    source: 'github',
    workflowId: makeWorkflow().id,
    projectIds,
    active: opts.active ?? true,
    webhookEvent: opts.event ?? 'push',
    webhookBranches: opts.branches ?? [],
    issueActions: opts.issueActions ?? ['opened'],
    issueLabel: opts.issueLabel ?? null,
  }).returning().get()
}

function runsOf(triggerId: number) {
  return db.select().from(schema.runs).where(eq(schema.runs.triggerId, triggerId)).all()
}

const repo = (project: { githubId: number, fullName: string }) => ({ id: project.githubId, full_name: project.fullName })

describe('github webhook route, unconfigured', () => {
  it('answers 404 until the app has a webhook secret', async () => {
    const res = await deliver('push', { ref: 'refs/heads/main' })
    expect(res.status).toBe(404)
  })
})

describe('github webhook route', () => {
  beforeAll(() => {
    saveGithubAppCredentials({ appId: '1', slug: 'knecht-test', clientId: 'c', clientSecret: 'x', privateKey: 'x', webhookSecret: SECRET })
    db.insert(schema.members).values({ login: 'samuelreichor' }).run()
  })

  it('rejects a bad signature', async () => {
    const res = await deliver('push', { ref: 'refs/heads/main' }, 'wrong')
    expect(res.status).toBe(401)
  })

  it('skips deliveries for repositories that are not projects', async () => {
    const res = await deliver('push', { ref: 'refs/heads/main', repository: { id: 999_999, full_name: 'x/y' } })
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ ok: true, skipped: 'no matching project' })
  })

  it('fires a push trigger with the branch and the commit as inputs', async () => {
    const project = makeProject()
    const trigger = makeGithubTrigger([project.id], { branches: ['main'] })
    const res = await deliver('push', {
      ref: 'refs/heads/main',
      after: 'abcdef1234567',
      head_commit: { message: 'fix: things', url: 'https://x/commit/abcdef1' },
      repository: repo(project),
    })
    expect(res.json).toEqual({ ok: true, runIds: [expect.any(Number)] })
    const [run] = runsOf(trigger.id)
    expect(run).toMatchObject({
      projectId: project.id,
      triggerId: trigger.id,
      trigger: 'github',
      branch: 'main',
      inputs: { event: 'push', identifier: 'abcdef1', title: 'fix: things', body: '', url: 'https://x/commit/abcdef1' },
    })
    expect(getSessionRow(run!.sessionId).objectKind).toBeNull()
  })

  it('ignores pushes outside the branch filter, deleted refs, inactive triggers and other projects', async () => {
    const project = makeProject()
    const other = makeProject()
    const filtered = makeGithubTrigger([project.id], { branches: ['main'] })
    const inactive = makeGithubTrigger([project.id], { active: false })
    const elsewhere = makeGithubTrigger([other.id])
    const any = makeGithubTrigger([project.id])

    await deliver('push', { ref: 'refs/heads/feature', repository: repo(project) })
    await deliver('push', { ref: 'refs/heads/main', deleted: true, repository: repo(project) })
    await deliver('push', { ref: 'refs/tags/v1', repository: repo(project) })

    expect(runsOf(filtered.id)).toHaveLength(0)
    expect(runsOf(inactive.id)).toHaveLength(0)
    expect(runsOf(elsewhere.id)).toHaveLength(0)
    expect(runsOf(any.id)).toHaveLength(1)
    expect(runsOf(any.id)[0]!.branch).toBe('feature')
  })

  it('fires a pull_request trigger on the base filter and checks out the head', async () => {
    const project = makeProject()
    const trigger = makeGithubTrigger([project.id], { event: 'pull_request', branches: ['main'] })
    const pr = { number: 42, title: 'Add feature', body: 'Because', html_url: 'https://x/pull/42', head: { ref: 'feat' }, base: { ref: 'main' } }

    await deliver('pull_request', { action: 'labeled', pull_request: pr, repository: repo(project) })
    expect(runsOf(trigger.id)).toHaveLength(0)

    await deliver('pull_request', { action: 'opened', pull_request: { ...pr, base: { ref: 'develop' } }, repository: repo(project) })
    expect(runsOf(trigger.id)).toHaveLength(0)

    await deliver('pull_request', { action: 'synchronize', pull_request: pr, repository: repo(project) })
    const [run] = runsOf(trigger.id)
    expect(run).toMatchObject({
      branch: 'feat',
      inputs: { event: 'pull_request', identifier: '42', title: 'Add feature', body: 'Because', url: 'https://x/pull/42' },
    })
    const session = getSessionRow(run!.sessionId)
    expect(session).toMatchObject({ objectIntegration: 'github', objectKind: 'pull_request', objectKey: '42', objectTitle: 'Add feature', objectUrl: 'https://x/pull/42' })
  })

  it('fires an issues trigger on opened and on the configured label only', async () => {
    const project = makeProject()
    const opened = makeGithubTrigger([project.id], { event: 'issues' })
    const labeled = makeGithubTrigger([project.id], { event: 'issues', issueActions: ['labeled'], issueLabel: 'knecht' })
    const issue = { number: 7, title: 'Broken', body: 'boom', html_url: 'https://x/issues/7' }

    await deliver('issues', { action: 'opened', issue, repository: repo(project) })
    expect(runsOf(opened.id)).toHaveLength(1)
    expect(runsOf(labeled.id)).toHaveLength(0)

    await deliver('issues', { action: 'labeled', issue, label: { name: 'other' }, repository: repo(project) })
    expect(runsOf(labeled.id)).toHaveLength(0)

    await deliver('issues', { action: 'labeled', issue, label: { name: 'knecht' }, repository: repo(project) })
    const [run] = runsOf(labeled.id)
    expect(run).toMatchObject({
      branch: 'main',
      inputs: { event: 'issues', identifier: '7', title: 'Broken', body: 'boom', url: 'https://x/issues/7' },
    })
    expect(runsOf(opened.id)[0]!.sessionId).toBe(run!.sessionId)
    expect(getSessionRow(run!.sessionId)).toMatchObject({ objectIntegration: 'github', objectKind: 'issue', objectKey: '7' })
  })

  it('mirrors closed and reopened onto the object session', async () => {
    const project = makeProject()
    const session = resolveSession(project, { integration: 'github', kind: 'issue', key: '3', title: 'Flaky' }, null)
    const issue = { number: 3, title: 'Flaky', html_url: 'https://x/issues/3' }

    await deliver('issues', { action: 'closed', issue, repository: repo(project) })
    expect(getSessionRow(session.id).status).toBe('closed')

    await deliver('issues', { action: 'reopened', issue, repository: repo(project) })
    expect(getSessionRow(session.id).status).toBe('open')
  })

  it('hands issue comments to the mention handler', async () => {
    const project = makeProject()
    const res = await deliver('issue_comment', {
      action: 'created',
      issue: { number: 5, title: 'Help', html_url: 'https://x/issues/5' },
      comment: { id: 1, body: '@knecht-works please', user: { login: 'samuelreichor', type: 'User' } },
      repository: repo(project),
    })
    expect(res.json).toMatchObject({ ok: true, outcome: expect.stringContaining('setup hint') })
    expect(comments.at(-1)?.issue).toBe(5)
  })
})
