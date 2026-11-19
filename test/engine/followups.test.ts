import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { attachTestObject, makeProject, makeRun } from '../helpers/db'

const comments: { issue: number, body: string }[] = []
vi.mock('#server/utils/github-app', () => ({
  createIssueComment: async (_o: string, _r: string, issue: number, body: string) => {
    comments.push({ issue, body })
    return { url: 'https://x/comment' }
  },
}))
vi.mock('#server/daemon/envs', () => ({ reviveEnv: async () => {} }))
vi.mock('#server/daemon/git', () => ({ currentBranch: async () => 'main' }))
vi.mock('#server/daemon/session-sandbox', () => ({
  sessionSandbox: () => ({
    projectDir: '/var/www/html',
    ensureUp: async () => {},
    stream: async () => ({ code: 0, tail: '' }),
    spawn: () => { throw new Error('not in this test') },
    copyIn: async () => {},
  }),
}))
const agent = vi.hoisted(() => ({ reply: async (): Promise<string> => 'agent reply', messages: [] as string[] }))
vi.mock('#server/workflows/actions/ai', async importOriginal => ({
  ...await importOriginal<typeof import('#server/workflows/actions/ai')>(),
  runFollowupPrompt: (_rt: unknown, message: string) => {
    agent.messages.push(message)
    return agent.reply()
  },
}))

const boot = vi.hoisted(() => ({ calls: 0, error: null as string | null }))
vi.mock('#server/workflows/actions/ddev-start', () => ({
  ddevStartAction: {
    run: async (_step: unknown, rt: { log: (text: string) => void }) => {
      boot.calls++
      rt.log('\n▶ ddev-start\nStarting web container\n')
      if (boot.error) throw new Error(boot.error)
      return undefined
    },
  },
}))

const { db, schema } = await import('#server/db')
const { recordAgentReply } = await import('#server/utils/sessions')
const { startFollowup } = await import('#server/daemon/followups')
const getRunStatus = (id: number) => db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()!.status

function objectFollowup(origin: 'mention' | 'dashboard') {
  const project = makeProject()
  const run = makeRun(project, [], { status: 'success' })
  attachTestObject(run.sessionId, { integration: 'github', kind: 'issue', key: '5' })
  const followup = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'more', origin }).returning().get()
  return { run, followup }
}

describe('follow-up hand-over', () => {
  it('opens the first turn after /compact with the stored summary, once', async () => {
    const { run } = objectFollowup('dashboard')
    db.update(schema.sessions).set({ agentHandover: 'Goal: recolor the pill. Branch pill-recolor has the change.' }).where(eq(schema.sessions.id, run.sessionId)).run()
    const first = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'continue' }).returning().get()
    await startFollowup(first.id)
    expect(agent.messages.at(-1)).toMatch(/^Hand-over from the previous conversation in this session, read it before acting:\n\nGoal: recolor the pill/)
    expect(agent.messages.at(-1)).toContain('continue')

    const second = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'and again' }).returning().get()
    await startFollowup(second.id)
    expect(agent.messages.at(-1)).not.toContain('Hand-over')
  })
})

describe('follow-up attachments', () => {
  it('names the staged sandbox paths in the prompt', async () => {
    const { run } = objectFollowup('dashboard')
    const followup = db.insert(schema.followups).values({
      sessionId: run.sessionId,
      runId: run.id,
      prompt: 'use the screenshot',
      attachments: [{ name: 'shot.png', size: 2048, type: 'image/png' }],
    }).returning().get()
    await startFollowup(followup.id)
    expect(agent.messages.at(-1)).toContain('use the screenshot')
    expect(agent.messages.at(-1)).toContain(`/tmp/knecht-attachments/${followup.id}/shot.png (image/png, 2 KB)`)
  })
})

describe('follow-up message', () => {
  it('tells the agent in a code session that a running environment needs knecht-preview', async () => {
    const code = objectFollowup('dashboard')
    db.update(schema.sessions).set({ tier: 'code' }).where(eq(schema.sessions.id, code.run.sessionId)).run()
    await startFollowup(code.followup.id)
    expect(agent.messages.at(-1)).toContain('This is a code session (no database, no running site).')

    const preview = objectFollowup('dashboard')
    db.update(schema.sessions).set({ tier: 'preview' }).where(eq(schema.sessions.id, preview.run.sessionId)).run()
    await startFollowup(preview.followup.id)
    expect(agent.messages.at(-1)).not.toContain('This is a code session')
  })
})

describe('follow-up replies on the thread', () => {
  it('posts the agent reply on the object for mentions', async () => {
    const { followup } = objectFollowup('mention')
    agent.reply = async () => 'Fixed it.'
    await startFollowup(followup.id)
    expect(comments.at(-1)).toEqual({ issue: 5, body: 'Fixed it.' })
  })

  it('stays silent for dashboard follow-ups', async () => {
    const { followup } = objectFollowup('dashboard')
    comments.length = 0
    await startFollowup(followup.id)
    expect(comments).toHaveLength(0)
  })

  it('tells the agent where a mention came from and who asked', async () => {
    agent.reply = async () => 'ok'
    const mention = objectFollowup('mention')
    db.update(schema.followups).set({ requestedBy: 'ann' }).where(eq(schema.followups.id, mention.followup.id)).run()
    await startFollowup(mention.followup.id)
    expect(agent.messages.at(-1)).toContain('This session holds issue #5. This task comes from issue #5, asked by ann.')
    expect(agent.messages.at(-1)).not.toContain('--on')
    expect(agent.messages.at(-1)).toContain('more')
  })

  it('tells the agent a dashboard follow-up is about the whole session and posting needs --on', async () => {
    agent.reply = async () => 'ok'
    const project = makeProject()
    const run = makeRun(project, [], { status: 'success' })
    attachTestObject(run.sessionId, { integration: 'github', kind: 'issue', key: '5' })
    const pr = attachTestObject(run.sessionId, { integration: 'github', kind: 'pull_request', key: '42' })
    const followup = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'more', origin: 'dashboard', objectId: pr.id, requestedBy: 'sam' }).returning().get()
    await startFollowup(followup.id)
    const message = agent.messages.at(-1)
    expect(message).toContain('This session holds issue #5, pull request #42. sam asked this in the Knecht dashboard: answer in your final message')
    expect(message).toContain('knecht-reply and knecht-label then need --on <KEY>')
  })

  it('does not double-post when the agent already replied through the bridge', async () => {
    const { run, followup } = objectFollowup('mention')
    comments.length = 0
    agent.reply = async () => {
      recordAgentReply(run.sessionId)
      return 'already said it'
    }
    await startFollowup(followup.id)
    expect(comments).toHaveLength(0)
  })

  it('reports a failure on the thread', async () => {
    const { followup } = objectFollowup('mention')
    agent.reply = async () => {
      throw new Error('agent exploded')
    }
    await startFollowup(followup.id)
    expect(comments.at(-1)).toEqual({ issue: 5, body: 'I could not finish this: agent exploded' })
    expect(db.select().from(schema.followups).where(eq(schema.followups.id, followup.id)).get()!.status).toBe('failed')
  })
})

describe('agent follow-ups after knecht-preview', () => {
  const replyTo = { thread: 't1', person: { id: 'gh-1', name: 'ann' } }
  const followupRow = (id: number) => db.select().from(schema.followups).where(eq(schema.followups.id, id)).get()!
  const items = (followupId: number) => db.select().from(schema.agentItems).where(eq(schema.agentItems.followupId, followupId)).all().map(i => i.text)

  function mentionSession() {
    const project = makeProject()
    const run = makeRun(project, [], { status: 'queued', kind: 'mention' })
    const object = attachTestObject(run.sessionId, { integration: 'github', kind: 'issue', key: '5' })
    const mention = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'check the footer', origin: 'mention', objectId: object.id, replyTo }).returning().get()
    const queueAgentTurn = () => db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'look at the footer', origin: 'agent', objectId: object.id, replyTo }).returning().get()
    return { run, mention, queueAgentTurn }
  }

  it('answers the thread once, after the boot, and keeps the mention run going until then', async () => {
    const { run, mention, queueAgentTurn } = mentionSession()
    const setupRun = makeRun(makeProject(), [], { sessionId: run.sessionId, status: 'success' })
    comments.length = 0
    boot.calls = 0
    boot.error = null
    let agentTurn: ReturnType<typeof queueAgentTurn> | undefined
    agent.reply = async () => {
      agentTurn = queueAgentTurn()
      return 'Booting the preview to check the footer.'
    }
    await startFollowup(mention.id)
    expect(comments).toHaveLength(0)
    expect(getRunStatus(run.id)).toBe('running')

    agent.reply = async () => 'The footer links work.'
    await startFollowup(agentTurn!.id)
    expect(boot.calls).toBe(1)
    expect(items(agentTurn!.id)).toContain('Booted the preview')
    expect(items(agentTurn!.id).join()).not.toContain('Starting web container')
    const setup = db.select().from(schema.runs).where(eq(schema.runs.id, setupRun.id)).get()!
    expect(setup.log).toContain('Starting web container')
    expect(db.select().from(schema.runSteps).where(eq(schema.runSteps.runId, setupRun.id)).all()).toMatchObject([{ type: 'ddev-start', origin: 'followup', status: 'success' }])
    expect(agent.messages.at(-1)).toContain('Knecht booted the preview you asked for with knecht-preview.')
    expect(agent.messages.at(-1)).toContain('What you wanted to do with it: look at the footer')
    expect(comments).toEqual([{ issue: 5, body: 'The footer links work.' }])
    expect(getRunStatus(run.id)).toBe('success')
  })

  it('tells the agent the boot failed and still answers', async () => {
    const { queueAgentTurn } = mentionSession()
    const turn = queueAgentTurn()
    boot.error = 'ddev start exited with code 1'
    agent.reply = async () => 'Fixed, but the preview did not boot.'
    await startFollowup(turn.id)
    boot.error = null
    expect(db.select().from(schema.agentItems).where(eq(schema.agentItems.followupId, turn.id)).all()).toMatchObject([{ type: 'tool', kind: 'preview', status: 'failed', text: 'The preview did not boot', output: 'ddev start exited with code 1' }])
    expect(db.select().from(schema.runSteps).where(eq(schema.runSteps.runId, turn.runId)).all()).toMatchObject([{ status: 'failed', error: 'ddev start exited with code 1' }])
    expect(agent.messages.at(-1)).toContain('did not boot: ddev start exited with code 1')
    expect(followupRow(turn.id).status).toBe('success')
    expect(comments.at(-1)).toEqual({ issue: 5, body: 'Fixed, but the preview did not boot.' })
  })

  it('stays off the thread when it continues a dashboard turn', async () => {
    const { run } = objectFollowup('dashboard')
    const turn = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: '', origin: 'agent' }).returning().get()
    comments.length = 0
    await startFollowup(turn.id)
    expect(comments).toHaveLength(0)
    expect(agent.messages.at(-1)).not.toContain('What you wanted to do with it')
  })
})
