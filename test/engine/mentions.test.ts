import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { getSessionRow, makeProject, makeRun } from '../helpers/db'

// The mention pipeline (ADR 0007) against the real schema: member gate,
// starter-run bootstrapping, follow-up queueing, and the setup hint. Only the
// GitHub API and the dispatcher are faked.

const reactions: number[] = []
const comments: { issue: number, body: string }[] = []
vi.mock('../../server/utils/github-app', () => ({
  addCommentReaction: async (_o: string, _r: string, id: number) => {
    reactions.push(id)
  },
  createIssueComment: async (_o: string, _r: string, issue: number, body: string) => {
    comments.push({ issue, body })
    return { url: 'https://x/comment' }
  },
}))
vi.mock('../../server/daemon/dispatcher', () => ({ dispatchRuns: () => {} }))

const { db, schema } = await import('../../server/db')
const { handleMention } = await import('../../server/utils/mentions')

function payload(body: string, overrides: Record<string, unknown> = {}) {
  return {
    action: 'created',
    issue: { number: 5, title: 'Broken build', html_url: 'https://x/issues/5' },
    comment: { id: 99, body, user: { login: 'SamuelReichor', type: 'User' } },
    ...overrides,
  }
}

function makeStarter() {
  return db.insert(schema.workflows).values({
    name: `starter-${Math.random().toString(36).slice(2, 8)}`,
    steps: [{ type: 'ddev-start', id: 'boot' }],
    publishedAt: new Date(),
  }).returning().get()
}

beforeAll(() => {
  db.insert(schema.githubApp).values({
    id: 1,
    appId: '1',
    slug: 'knecht-test',
    clientId: 'c',
    clientSecretEnc: 'x',
    privateKeyEnc: 'x',
  }).run()
  db.insert(schema.members).values({ login: 'samuelreichor' }).run()
})

describe('handleMention', () => {
  it('ignores comments that do not mention the app, and non-members', async () => {
    const project = makeProject()
    expect(await handleMention(project, payload('just chatting'))).toContain('no mention')
    expect(await handleMention(project, payload('@knecht-test do it', {
      comment: { id: 1, body: '@knecht-test do it', user: { login: 'stranger', type: 'User' } },
    }))).toContain('not an instance member')
    expect(await handleMention(project, payload('@knecht-test hi', {
      comment: { id: 1, body: '@knecht-test hi', user: { login: 'other[bot]', type: 'Bot' } },
    }))).toContain('bot comment')
  })

  it('replies with a setup hint when no starter workflow is configured', async () => {
    const project = makeProject()
    const outcome = await handleMention(project, payload('@knecht-test please fix'))
    expect(outcome).toContain('setup hint')
    expect(comments.at(-1)?.body).toContain('starter workflow')
  })

  it('boots a starter run and queues the mention as its own run + follow-up', async () => {
    const starter = makeStarter()
    const project = makeProject({ starterWorkflowId: starter.id })
    reactions.length = 0

    const outcome = await handleMention(project, payload('@Knecht-Test check the login page'))
    expect(outcome).toContain('queued starter run')
    // Acknowledged with a reaction on the mention comment.
    expect(reactions).toEqual([99])

    const runs = db.select().from(schema.runs).where(eq(schema.runs.projectId, project.id)).all()
    expect(runs).toHaveLength(2)
    const [starterRun, mentionRun] = runs as [typeof runs[0], typeof runs[0]]
    expect(starterRun.workflowId).toBe(starter.id)
    expect(starterRun.kind).toBe('workflow')
    expect(mentionRun.kind).toBe('mention')
    expect(mentionRun.trigger).toBe('mention')
    const session = getSessionRow(starterRun.sessionId)
    expect(session.objectKind).toBe('issue')
    expect(session.objectNumber).toBe(5)

    // The follow-up anchors the mention's OWN run, not the starter: its
    // timeline must never land inside the starter workflow's run.
    const followup = db.select().from(schema.followups).where(eq(schema.followups.sessionId, session.id)).get()!
    expect(followup.runId).toBe(mentionRun.id)
    expect(followup.origin).toBe('mention')
    expect(followup.prompt).toContain('check the login page')
    expect(followup.requestedBy).toBe('samuelreichor')
  })

  it('a second mention while the starter is pending adds only a mention run', async () => {
    const starter = makeStarter()
    const project = makeProject({ starterWorkflowId: starter.id })
    await handleMention(project, payload('@knecht-test first'))
    await handleMention(project, payload('@knecht-test second'))

    const runs = db.select().from(schema.runs).where(eq(schema.runs.projectId, project.id)).all()
    // ONE starter boot, one mention run per mention.
    expect(runs.filter(r => r.kind === 'workflow')).toHaveLength(1)
    expect(runs.filter(r => r.kind === 'mention')).toHaveLength(2)
    const followups = db.select().from(schema.followups).where(eq(schema.followups.sessionId, runs[0]!.sessionId)).all()
    expect(followups).toHaveLength(2)
  })

  it('a mention on an object with a live session gets its own run', async () => {
    const project = makeProject()
    // A trigger already worked on issue #5: session exists with an env.
    const run = makeRun(project, [], { status: 'success' })
    db.update(schema.sessions)
      .set({ objectKind: 'issue', objectNumber: 5, envState: 'stopped' })
      .where(eq(schema.sessions.id, run.sessionId))
      .run()

    const outcome = await handleMention(project, payload('@knecht-test and now fix it'))
    expect(outcome).toContain(`on session ${run.sessionId}`)
    const mentionRun = db.select().from(schema.runs)
      .where(eq(schema.runs.sessionId, run.sessionId)).all()
      .find(r => r.kind === 'mention')!
    expect(mentionRun.workflow).toBe('Mention')
    const followup = db.select().from(schema.followups).where(eq(schema.followups.sessionId, run.sessionId)).get()!
    expect(followup.runId).toBe(mentionRun.id)
  })

  it('respects the project toggle', async () => {
    const project = makeProject({ mentionsEnabled: false })
    expect(await handleMention(project, payload('@knecht-test hello'))).toContain('mentions disabled')
  })
})
