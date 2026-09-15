import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeProject, makeRun } from '../helpers/db'

const comments: { issue: number, body: string }[] = []
vi.mock('../../server/utils/github-app', () => ({
  createIssueComment: async (_o: string, _r: string, issue: number, body: string) => {
    comments.push({ issue, body })
    return { url: 'https://x/comment' }
  },
}))
vi.mock('../../server/daemon/envs', () => ({ ensureEnvUp: async () => {}, reviveEnv: async () => {} }))
vi.mock('../../server/daemon/git', () => ({ currentBranch: async () => 'main' }))
vi.mock('../../server/daemon/sandbox', () => ({
  WEB_PROJECT_DIR: '/var/www/html',
  copyIntoSandbox: async () => {},
  spawnInSandbox: () => { throw new Error('not in this test') },
  streamInSandbox: async () => {},
}))
const agent = vi.hoisted(() => ({ reply: async (): Promise<string> => 'agent reply' }))
vi.mock('../../server/workflows/actions/ai', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/workflows/actions/ai')>(),
  runFollowupPrompt: () => agent.reply(),
}))

const { db, schema } = await import('../../server/db')
const { recordAgentReply } = await import('../../server/utils/sessions')
const { startFollowup } = await import('../../server/daemon/followups')

function objectFollowup(origin: 'mention' | 'dashboard') {
  const project = makeProject()
  const run = makeRun(project, [], { status: 'success' })
  db.update(schema.sessions).set({ objectIntegration: 'github', objectKind: 'issue', objectKey: '5' }).where(eq(schema.sessions.id, run.sessionId)).run()
  const followup = db.insert(schema.followups).values({ sessionId: run.sessionId, runId: run.id, prompt: 'more', origin }).returning().get()
  return { run, followup }
}

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
