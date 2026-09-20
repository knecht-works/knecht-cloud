import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { callRoute } from '../helpers/routes'
import type { Project } from '../../server/db/schema'
import type { TriggerConfig } from '../../shared/utils/trigger-form'
import { getSessionRow, makeProject } from '../helpers/db'
import { describeIntegrationWebhook, makeTrigger, runsOf, type WebhookRequest } from '../helpers/integration-webhook-suite'

const comments: { repo: string, issue: number, body: string }[] = []
vi.mock('../../server/utils/github-app', () => ({
  addCommentReaction: async () => {},
  createIssueComment: async (_o: string, repo: string, issue: number, body: string) => {
    comments.push({ repo, issue, body })
    return { url: 'https://x/comment' }
  },
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { db, schema } = await import('../../server/db')
const { saveGithubAppCredentials } = await import('../../server/utils/github-credentials')
const { github } = await import('../../server/integrations/github')
const handler = (await import('../../server/api/github/webhook.post')).default

const SECRET = 'whsec-test'

interface GithubDelivery {
  event: string
  payload: object
}

function request({ event, payload }: GithubDelivery, secret = SECRET): WebhookRequest {
  const body = JSON.stringify(payload)
  return {
    body,
    headers: {
      'x-github-event': event,
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
  }
}

function deliver(event: string, payload: object) {
  return callRoute(handler, request({ event, payload }))
}

const PR_OPENED_OR_PUSHED: TriggerConfig = { kind: 'pull_request', on: [{ type: 'opened' }, { type: 'pushed' }], filters: {} }

function makeGithubTrigger(projectIds: number[], config: TriggerConfig = PR_OPENED_OR_PUSHED) {
  return makeTrigger('github', projectIds, config)
}

const repo = (project: { githubId: number, fullName: string }) => ({ id: project.githubId, full_name: project.fullName })

let repoN = 0
function makeRepoProject() {
  const name = `repo-${++repoN}`
  return makeProject({ name, fullName: `knecht-works/${name}` })
}

const ISSUE = { number: 12, title: 'Login broken', body: 'It fails on submit.', html_url: 'https://x/issues/12' }

function commented(project: Project, body: string, user: { login: string, type: string }): GithubDelivery {
  return { event: 'issue_comment', payload: { action: 'created', issue: ISSUE, comment: { id: 1, body, user }, repository: repo(project) } }
}

describeIntegrationWebhook<Project, GithubDelivery>({
  integration: github,
  handler,
  configure: () => {
    saveGithubAppCredentials({ appId: '1', slug: 'knecht-test', clientId: 'c', clientSecret: 'x', privateKey: 'x', webhookSecret: SECRET })
    db.insert(schema.members).values({ login: 'samuelreichor' }).run()
  },
  request,
  makeProject: makeRepoProject,
  unknownProject: () => ({ event: 'issues', payload: { action: 'opened', issue: ISSUE, repository: { id: 999_999, full_name: 'x/y' } } }),
  object: () => ({ integration: 'github', kind: 'issue', key: '12' }),
  created: {
    config: { kind: 'issue', on: [{ type: 'opened' }], filters: {} },
    delivery: project => ({ event: 'issues', payload: { action: 'opened', issue: ISSUE, repository: repo(project) } }),
    run: () => ({
      trigger: 'github',
      branch: 'main',
      inputs: { event: 'issues', identifier: '12', title: 'Login broken', body: 'It fails on submit.', url: 'https://x/issues/12' },
    }),
    session: () => ({ objectIntegration: 'github', objectKind: 'issue', objectKey: '12', objectTitle: 'Login broken', objectUrl: 'https://x/issues/12' }),
  },
  labeled: {
    config: { kind: 'issue', on: [{ type: 'labeled', value: 'knecht' }], filters: {} },
    notGained: project => [
      { event: 'issues', payload: { action: 'opened', issue: ISSUE, repository: repo(project) } },
      { event: 'issues', payload: { action: 'labeled', issue: ISSUE, label: { name: 'other' }, repository: repo(project) } },
    ],
    gained: project => ({ event: 'issues', payload: { action: 'labeled', issue: ISSUE, label: { name: 'knecht' }, repository: repo(project) } }),
  },
  closed: project => ({ event: 'issues', payload: { action: 'closed', issue: ISSUE, repository: repo(project) } }),
  reopened: project => ({ event: 'issues', payload: { action: 'reopened', issue: ISSUE, repository: repo(project) } }),
  comment: {
    mention: project => commented(project, '@knecht-works please', { login: 'samuelreichor', type: 'User' }),
    fromSelf: project => commented(project, '@knecht-works I am Knecht', { login: 'knecht-test[bot]', type: 'Bot' }),
    withoutMention: project => commented(project, 'just chatting', { login: 'samuelreichor', type: 'User' }),
    replyCount: project => comments.filter(c => c.repo === project.name && c.issue === 12).length,
  },
})

describe('github webhook route, vendor specifics', () => {
  it('ignores push deliveries', async () => {
    const project = makeProject()
    const trigger = makeGithubTrigger([project.id])
    const res = await deliver('push', { ref: 'refs/heads/main', repository: repo(project) })
    expect(res.status).toBe(200)
    expect(runsOf(trigger.id)).toHaveLength(0)
  })

  it('fires a pull_request trigger on the base filter and checks out the head', async () => {
    const project = makeProject()
    const trigger = makeGithubTrigger([project.id], { ...PR_OPENED_OR_PUSHED, filters: { base: ['main'] } })
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
})
