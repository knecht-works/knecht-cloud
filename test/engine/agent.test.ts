import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import type { Step } from '../../shared/utils/workflow'
import { checkoutDirOf } from '../helpers/local-sandbox'
import { getRun, getSteps, makeProject, makeRun } from '../helpers/db'

vi.mock('../../server/daemon/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/daemon/git')>()
  const { fakeCheckout } = await import('../helpers/local-sandbox')
  return { ...actual, prepareSessionCheckout: fakeCheckout }
})
vi.mock('../../server/daemon/sandbox', async () => {
  const { execInSandbox, copyIntoSandbox, streamInSandbox, spawnInSandbox } = await import('../helpers/local-sandbox')
  return { execInSandbox, copyIntoSandbox, streamInSandbox, spawnInSandbox, startEnvStack: async () => {}, WEB_PROJECT_DIR: '/var/www/html' }
})
vi.mock('../../server/daemon/envs', () => ({ ensureEnvUp: async () => {}, reviveEnv: async () => {} }))
vi.mock('../../server/utils/github-app', () => ({
  getInstallationToken: async () => 'test-token',
  getBotIdentity: async () => ({ name: 'Knecht Test', email: 'test@knecht.works' }),
  createIssueComment: async () => {},
}))
// Nitro's useStorage does not exist in the engine tests.
vi.mock('../../server/utils/sandbox-assets', () => ({ readSandboxAsset: async () => Buffer.from('# Knecht sandbox instructions\n') }))

const { startRun, cancelRun } = await import('../../server/daemon/runner')
const { startFollowup } = await import('../../server/daemon/followups')
const { updateSettings } = await import('../../server/utils/settings')
const { encrypt } = await import('../../server/utils/crypto')

updateSettings({ aiProvider: 'anthropic', aiModel: 'claude-sonnet-4-5', aiKeyEnc: encrypt('sk-test') })

function itemsOf(followupId: number) {
  return db.select().from(schema.agentItems).where(eq(schema.agentItems.followupId, followupId)).orderBy(schema.agentItems.seq).all()
}

async function runAi(step: Partial<Extract<Step, { type: 'ai' }>>) {
  const project = makeProject()
  const run = makeRun(project, [{ type: 'ai', id: 'agent', prompt: 'do the thing', ...step }])
  await startRun(run.id, project)
  return { run: getRun(run.id), step: getSteps(run.id)[0]!, project }
}

describe('ai step over ACP', () => {
  it('returns the agent\'s last message and logs one line per tool call, never the tool output', async () => {
    const { run, step } = await runAi({})
    expect(run.status).toBe('success')
    expect(step.outputs).toEqual({ text: 'Hello from stub (fresh)' })
    expect(run.log).toContain('read: Read AGENTS.md')
    expect(run.log).toContain('run: npm test')
    expect(run.log).toContain('Thinking about it.')
    expect(run.log).not.toContain('secret file contents')
  })

  it('writes the agent config the sandbox reads: model and open permissions', async () => {
    const { run } = await runAi({})
    const config = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(`${checkoutDirOf(run.id)}/.knecht/opencode/opencode.json`, 'utf8')))
    expect(config).toMatchObject({ model: 'anthropic/claude-sonnet-4-5', permission: 'allow' })
  })

  it('answers a permission request with allow', async () => {
    const { step } = await runAi({ prompt: 'ASK_PERMISSION' })
    expect(step.outputs).toEqual({ text: 'permission: allow' })
  })

  it('validates an output contract the agent wrote to the file', async () => {
    const { run, step } = await runAi({ prompt: 'WRITE_OUTPUT {"title":"hi","tags":["a"]}', output: 'title: string\ntags: string[]' })
    expect(step.error).toBeNull()
    expect(run.status).toBe('success')
    expect(step.outputs).toMatchObject({ json: { title: 'hi', tags: ['a'] } })
  })

  it('fails the step when the agent process dies', async () => {
    const { run, step } = await runAi({ prompt: 'EXIT' })
    expect(run.status).toBe('failed')
    expect(step.error).toContain('agent exited with code 3')
  })

  it('cancels a hanging turn through the protocol', async () => {
    const project = makeProject()
    const run = makeRun(project, [{ type: 'ai', id: 'agent', prompt: 'HANG' }])
    const done = startRun(run.id, project)
    for (let i = 0; i < 100 && !getRun(run.id).log.includes('Read AGENTS.md'); i++) await new Promise(r => setTimeout(r, 50))
    expect(cancelRun(run.id)).toBe(true)
    await done
    expect(getRun(run.id).status).toBe('cancelled')
    expect(getSteps(run.id)[0]!.status).toBe('cancelled')
  })
})

describe('follow-ups over ACP', () => {
  it('opens one agent session for the chat and resumes it on the next message', async () => {
    const { run } = await runAi({})
    const sessionId = run.sessionId
    const session = () => db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()!
    // The workflow step's own agent session is never the chat's.
    expect(session().agentSessionId).toBeNull()
    const followup = (prompt: string) => db.insert(schema.followups).values({ sessionId, runId: run.id, prompt }).returning().get()

    await startFollowup(followup('first').id)
    expect(session().agentSessionId).toMatch(/^ses_stub_/)

    db.update(schema.sessions).set({ agentSessionId: 'ses_stub_known' }).where(eq(schema.sessions.id, sessionId)).run()
    const second = followup('second LOADED')
    await startFollowup(second.id)
    expect(itemsOf(second.id).filter(i => i.type === 'message').at(-1)!.text).toBe('Hello from stub (loaded)')
    expect(session().agentSessionId).toBe('ses_stub_known')
    // The chat has its own transcript: nothing of it lands in the run log or as a step row.
    expect(getSteps(run.id).filter(s => s.origin === 'followup')).toHaveLength(0)
    expect(getRun(run.id).log).not.toContain('Hello from stub (loaded)')
  })

  it('switches a resumed session to the turn\'s model override', async () => {
    const { run } = await runAi({})
    db.update(schema.sessions).set({ agentSessionId: 'ses_stub_known' }).where(eq(schema.sessions.id, run.sessionId)).run()
    const plain = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'WHICH_MODEL' }).returning().get()
    await startFollowup(plain.id)
    expect(itemsOf(plain.id).find(i => i.type === 'message')!.text).toBe('model: anthropic/claude-sonnet-4-5')

    const override = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'WHICH_MODEL', model: 'claude-opus-4-6' }).returning().get()
    await startFollowup(override.id)
    expect(itemsOf(override.id).find(i => i.type === 'message')!.text).toBe('model: anthropic/claude-opus-4-6')
  })

  it('stores the turn as transcript items: messages, tool calls with capped output, usage', async () => {
    const { run } = await runAi({})
    const followup = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'hello' }).returning().get()
    await startFollowup(followup.id)
    const items = itemsOf(followup.id)
    expect(items.map(i => [i.type, i.text])).toEqual([
      ['tool', 'Read AGENTS.md'],
      ['message', 'Thinking about it.'],
      ['tool', 'npm test'],
      ['message', 'Hello from stub (fresh)'],
      ['usage', ''],
    ])
    expect(items[0]).toMatchObject({ kind: 'read', status: 'completed', output: 'secret file contents', sessionId: run.sessionId })
    expect(items[2]).toMatchObject({ kind: 'execute', status: 'completed', diff: { path: 'package.json', oldText: 'a', newText: 'b' } })
    expect(items[4]).toMatchObject({ tokens: { used: 1200, size: 200000 }, cost: 0.05 })
    expect(items.map(i => i.seq)).toEqual([0, 1, 2, 3, 4])
  })

  it('pushes every item to the session stream as it is written', async () => {
    const { onLive } = await import('../../server/utils/live')
    const { run } = await runAi({})
    const followup = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'hello' }).returning().get()
    const seen: string[] = []
    const off = onLive(run.sessionId, (e) => {
      if (e.type === 'item') seen.push(`${e.item.type}:${e.item.text}`)
      else if (e.type === 'followup') seen.push(`followup:${e.followup.status}`)
    })
    await startFollowup(followup.id)
    off()
    expect(seen[0]).toBe('followup:running')
    expect(seen.at(-1)).toBe('followup:success')
    expect(seen).toContain('message:Hello from ')
    expect(seen).toContain('message:Hello from stub (fresh)')
  })

  it('/compact summarizes silently and seeds the next turn\'s fresh session with it', async () => {
    const { run } = await runAi({})
    const session = () => db.select().from(schema.sessions).where(eq(schema.sessions.id, run.sessionId)).get()!
    db.update(schema.sessions).set({ agentSessionId: 'ses_stub_known' }).where(eq(schema.sessions.id, run.sessionId)).run()
    const compact = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: '/compact' }).returning().get()
    await startFollowup(compact.id)
    expect(itemsOf(compact.id).map(i => i.type)).toEqual(['divider'])
    expect(session().agentSessionId).toBeNull()
    expect(session().agentHandover).toBe('Hello from stub (fresh)')
    expect(db.select().from(schema.followups).where(eq(schema.followups.id, compact.id)).get()!.status).toBe('success')

    const next = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'go on' }).returning().get()
    await startFollowup(next.id)
    expect(session().agentSessionId).toMatch(/^ses_stub_\d+$/)
    expect(session().agentHandover).toBeNull()
  })

  it('continues the seq of a follow-up when a sink is reopened for it', async () => {
    const { transcriptSink } = await import('../../server/utils/agent-items')
    const { notice } = await import('../../server/daemon/agent')
    const { run } = await runAi({})
    const followup = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'hello' }).returning().get()
    await startFollowup(followup.id)
    transcriptSink(run.sessionId, followup.id).item(notice('posted late'))
    expect(itemsOf(followup.id).at(-1)).toMatchObject({ type: 'notice', text: 'posted late', seq: 5 })
  })

  it('caps a tool output at 4 KB', async () => {
    const { run } = await runAi({})
    const followup = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'BIG_OUTPUT' }).returning().get()
    await startFollowup(followup.id)
    const tool = itemsOf(followup.id).find(i => i.text === 'cat big.log')!
    expect(tool.output!.length).toBeLessThan(4200)
    expect(tool.output).toContain('more characters not kept')
  })

  it('starts a new chat session when the agent no longer knows the stored one', async () => {
    const { run } = await runAi({})
    db.update(schema.sessions).set({ agentSessionId: 'ses_gone' }).where(eq(schema.sessions.id, run.sessionId)).run()
    const followup = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'hello' }).returning().get()
    await startFollowup(followup.id)
    const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, run.sessionId)).get()!
    expect(session.agentSessionId).toMatch(/^ses_stub_/)
    expect(itemsOf(followup.id)[0]).toMatchObject({ type: 'notice', text: expect.stringContaining('Could not resume the agent session') })
  })
})
