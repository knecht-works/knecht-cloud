import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import type { Step } from '#shared/utils/workflow'
import { checkoutDirOf } from '../helpers/local-sandbox'
import { eq } from 'drizzle-orm'
import { db, schema } from '#server/db'
import { attachTestObject, getRun, getSessionRow, getSteps, makeProject, makeRun, makeSession, requeue } from '../helpers/db'

vi.mock('#server/daemon/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#server/daemon/git')>()
  const { fakeCheckout } = await import('../helpers/local-sandbox')
  return { ...actual, prepareSessionCheckout: fakeCheckout }
})
const startEnvStack = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('#server/daemon/sandbox', () => ({ startEnvStack }))
const removeWorkspace = vi.hoisted(() => vi.fn(async (_sessionId: number) => {}))
const ensureWorkspaceUp = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('#server/daemon/workspace', () => ({ ensureWorkspaceUp, removeWorkspace }))
const stopRunProcesses = vi.hoisted(() => vi.fn(async (_sessionId: number, _runId: number) => true))
vi.mock('#server/daemon/session-sandbox', async () => ({ sessionSandbox: (await import('../helpers/local-sandbox')).sessionSandbox, stopRunProcesses }))
vi.mock('#server/utils/github-app', () => ({
  getInstallationToken: async () => 'test-token',
  getBotIdentity: async () => ({ name: 'Knecht Test', email: 'test@knecht.works' }),
}))
const jiraComments = vi.hoisted(() => [] as { key: string, text: string, first?: unknown }[])
const jira = vi.hoisted(() => ({ assignee: null as { accountId: string, displayName: string } | null, assigned: [] as (string | null)[] }))
vi.mock('#server/integrations/jira/api', async importOriginal => ({
  ...await importOriginal<typeof import('#server/integrations/jira/api')>(),
  getJiraIssueFields: async () => ({ reporter: { accountId: 'user-1', displayName: 'Ann Example' } }),
  getJiraIssuePeople: async () => ({ assignee: jira.assignee, reporter: { accountId: 'user-1', displayName: 'Ann Example' } }),
  assignJiraIssue: async (_key: string, accountId: string | null) => {
    jira.assigned.push(accountId)
    jira.assignee = accountId ? { accountId, displayName: accountId } : null
  },
  addJiraComment: async (key: string, body: { content?: { content?: { text?: string, marks?: unknown }[] }[] }) => {
    const nodes = body.content?.[0]?.content ?? []
    jiraComments.push({ key, text: nodes.map(n => n.text ?? '').join(''), first: nodes[0] })
    return { url: 'https://x' }
  },
}))

const { startRun, cancelRun } = await import('#server/daemon/runner')
const { jiraConnection } = await import('#server/integrations/jira/credentials')

async function execute(steps: Step[], overrides: Parameters<typeof makeRun>[2] = {}) {
  const project = makeProject()
  const run = makeRun(project, steps, overrides)
  await startRun(run.id, project)
  return { project, run: getRun(run.id), steps: getSteps(run.id) }
}

describe('runner', () => {
  it('reports the pull request or the failure back on a Jira ticket', async () => {
    const project = makeProject()
    let n = 0
    const ticket = (overrides: Parameters<typeof makeRun>[2]) => {
      const run = makeRun(project, [{ type: 'bash', id: 'work', command: overrides.status === 'failed' ? 'exit 1' : 'true' }], { ...overrides, status: 'queued' })
      attachTestObject(run.sessionId, { integration: 'jira', kind: 'issue', key: `PROJ-${++n}` })
      return run
    }

    await startRun(ticket({ prUrl: 'https://x/pull/4' }).id, project)
    expect(jiraComments.at(-1)).toMatchObject({ key: 'PROJ-1', text: 'I opened a pull request for this ticket: https://x/pull/4' })

    jiraComments.length = 0
    await startRun(ticket({}).id, project)
    expect(jiraComments).toHaveLength(0)

    // The agent replied itself during the run (knecht-reply): no second comment about the PR.
    const { recordAgentReply } = await import('#server/utils/sessions')
    const replied = ticket({ prUrl: 'https://x/pull/6' })
    db.update(schema.runs).set({ steps: [{ type: 'bash', id: 'work', command: 'sleep 0.2' }] }).where(eq(schema.runs.id, replied.id)).run()
    const running = startRun(replied.id, project)
    await sleep(50)
    recordAgentReply(replied.sessionId)
    await running
    expect(jiraComments).toHaveLength(0)

    const failed = ticket({ status: 'failed' })
    await startRun(failed.id, project)
    expect(getRun(failed.id).status).toBe('failed')
    expect(jiraComments.at(-1)?.text).toContain(`I could not finish the run for this ticket: http://knecht.test/projects/${project.id}/sessions?run=${failed.id}`)

    const silent = db.insert(schema.workflows).values({ name: 'silent-jira', steps: [], repliesEnabled: false }).returning().get()
    jiraComments.length = 0
    await startRun(ticket({ prUrl: 'https://x/pull/5', workflowId: silent.id }).id, project)
    expect(jiraComments).toHaveLength(0)
  })

  it('holds a Jira ticket while it works and hands it back to whoever gave it to Knecht', async () => {
    jiraConnection.save({ siteUrl: 'https://acme.atlassian.net', email: 'knecht@acme.test', apiToken: 't' }, { accountName: 'Knecht', accountId: 'knecht' })
    const project = makeProject()
    let n = 0
    const ticket = (overrides: Parameters<typeof makeRun>[2]) => {
      const run = makeRun(project, [{ type: 'bash', id: 'work', command: 'true' }], overrides)
      attachTestObject(run.sessionId, { integration: 'jira', kind: 'issue', key: `PROJ-${++n}` })
      return run
    }

    jira.assignee = { accountId: 'user-2', displayName: 'Bob' }
    const review = makeRun(project, [{ type: 'bash', id: 'work', command: 'true' }])
    attachTestObject(review.sessionId, { integration: 'jira', kind: 'issue', key: 'REVIEW-1' })
    const pr = attachTestObject(review.sessionId, { integration: 'github', kind: 'pull_request', key: '9' })
    db.update(schema.runs).set({ objectId: pr.id }).where(eq(schema.runs.id, review.id)).run()
    await startRun(review.id, project)
    expect(jira.assigned).toEqual([])
    expect(getRun(review.id).log).not.toContain('Knecht holds')

    const assigned = ticket({ actor: { id: 'user-3', name: 'Sam' } })
    await startRun(assigned.id, project)
    expect(jira.assigned).toEqual(['knecht', 'user-3'])
    expect(getRun(assigned.id).log).toContain('handed PROJ-1 back to Sam')

    // Started by hand: whoever held the ticket before gets it back.
    jira.assigned.length = 0
    jira.assignee = { accountId: 'user-2', displayName: 'Bob' }
    await startRun(ticket({}).id, project)
    expect(jira.assigned).toEqual(['knecht', 'user-2'])

    jira.assigned.length = 0
    jira.assignee = null
    await startRun(ticket({}).id, project)
    expect(jira.assigned).toEqual(['knecht', 'user-1'])

    // Nothing is handed back while the session still has work queued; the queued run, started
    // by a change the agent made itself, hands back to whoever gave Knecht the ticket.
    jira.assigned.length = 0
    jira.assignee = null
    const busy = ticket({ actor: { id: 'user-3', name: 'Sam' } })
    const next = makeRun(project, [{ type: 'bash', id: 'work', command: 'true' }], { sessionId: busy.sessionId, status: 'queued' })
    await startRun(busy.id, project)
    expect(jira.assigned).toEqual(['knecht'])
    await startRun(next.id, project)
    expect(jira.assigned).toEqual(['knecht', 'user-3'])
    expect(getRun(next.id).log).toContain('handed PROJ-4 back to Sam')

    // Somebody took it from Knecht meanwhile: it stays theirs.
    jira.assigned.length = 0
    jira.assignee = null
    const taken = ticket({ actor: { id: 'user-3', name: 'Sam' } })
    db.update(schema.runs).set({ steps: [{ type: 'bash', id: 'work', command: 'sleep 0.3' }] }).where(eq(schema.runs.id, taken.id)).run()
    const running = startRun(taken.id, project)
    await sleep(100)
    jira.assignee = { accountId: 'user-2', displayName: 'Bob' }
    await running
    expect(jira.assigned).toEqual(['knecht'])
    expect(getRun(taken.id).log).toContain('left PROJ-5 with Bob')

    // The review on the PR the ticket's run opened ends the session's work: the ticket goes back too.
    jira.assigned.length = 0
    jira.assignee = null
    const shipped = ticket({ actor: { id: 'user-3', name: 'Sam' } })
    const shippedTicket = db.select().from(schema.sessionObjects).where(eq(schema.sessionObjects.sessionId, shipped.sessionId)).get()!
    db.update(schema.runs).set({ objectId: shippedTicket.id }).where(eq(schema.runs.id, shipped.id)).run()
    const opened = attachTestObject(shipped.sessionId, { integration: 'github', kind: 'pull_request', key: '10' })
    const reviewOfPr = makeRun(project, [{ type: 'bash', id: 'work', command: 'true' }], { sessionId: shipped.sessionId, status: 'queued', objectId: opened.id })
    await startRun(shipped.id, project)
    expect(jira.assigned).toEqual(['knecht'])
    await startRun(reviewOfPr.id, project)
    expect(jira.assigned).toEqual(['knecht', 'user-3'])
    expect(getRun(reviewOfPr.id).log).toContain(`handed ${shippedTicket.key} back to Sam`)
    jiraConnection.remove()
  })

  it('reports the result after handing the ticket back, addressed to whoever got it', async () => {
    jiraConnection.save({ siteUrl: 'https://acme.atlassian.net', email: 'knecht@acme.test', apiToken: 't' }, { accountName: 'Knecht', accountId: 'knecht' })
    const project = makeProject()
    const sam = { type: 'mention', attrs: { id: 'user-3', text: '@Sam' } }
    const ticket = (key: string, command: string, prUrl?: string) => {
      const run = makeRun(project, [{ type: 'bash', id: 'work', command }], { actor: { id: 'user-3', name: 'Sam' }, prUrl })
      attachTestObject(run.sessionId, { integration: 'jira', kind: 'issue', key: key })
      return run
    }

    jira.assignee = null
    jira.assigned.length = 0
    await startRun(ticket('PROJ-8', 'true', 'https://x/pull/8').id, project)
    expect(jira.assigned).toEqual(['knecht', 'user-3'])
    expect(jiraComments.at(-1)).toEqual({ key: 'PROJ-8', text: ' I opened a pull request for this ticket: https://x/pull/8', first: sam })

    jira.assignee = null
    jira.assigned.length = 0
    await startRun(ticket('PROJ-9', 'exit 1').id, project)
    expect(jira.assigned).toEqual(['knecht', 'user-3'])
    expect(jiraComments.at(-1)).toMatchObject({
      key: 'PROJ-9',
      text: expect.stringContaining(' I could not finish the run for this ticket:'),
      first: sam,
    })

    // Knecht keeps the ticket while more work is queued: whoever gave it to Knecht is addressed.
    jira.assignee = null
    const busy = ticket('PROJ-10', 'exit 1')
    makeRun(project, [], { sessionId: busy.sessionId, status: 'queued' })
    await startRun(busy.id, project)
    expect(jiraComments.at(-1)).toMatchObject({ key: 'PROJ-10', first: sam })
    jiraConnection.remove()
  })

  it('runs a linear workflow and passes outputs between steps', async () => {
    const { run, steps } = await execute([
      { type: 'bash', id: 'greet', command: 'echo hello' },
      { type: 'bash', id: 'use', command: 'echo got: {{ steps.greet.stdout }}' },
    ])
    expect(run.status).toBe('success')
    expect(getSessionRow(run.sessionId).status).toBe('open')
    expect(steps).toHaveLength(2)
    expect(steps.every(s => s.status === 'success')).toBe(true)
    expect(steps[1]!.params?.command).toBe('echo got: hello')
    expect(steps[1]!.outputs?.stdout).toBe('got: hello')
  })

  it('passes a ticket title into a shell step as text, never as code', async () => {
    const title = `'; $(echo INJECTED) "`
    const { steps } = await execute([
      { type: 'bash', id: 'echo', command: 'echo "title={{ inputs.title }}"; echo \'{{ inputs.title }}\'' },
    ], { inputs: { title } })
    expect(steps[0]!.status).toBe('success')
    expect(steps[0]!.outputs?.stdout).toBe(`title=${title}\n${title}`)
  })

  it('marks the session of a successful schedule run done and stops its environment', async () => {
    const workflow = db.insert(schema.workflows).values({ name: 'nightly', steps: [] }).returning().get()
    const schedule = db.insert(schema.triggers).values({ source: 'schedule', cron: '*/15 * * * *', workflowId: workflow.id, projectIds: [] }).returning().get()
    const fired = { trigger: 'schedule', triggerId: schedule.id }

    const { run } = await execute([{ type: 'bash', id: 'noop', command: 'true' }], fired)
    expect(getSessionRow(run.sessionId).status).toBe('closed')
    await vi.waitFor(() => expect(getSessionRow(run.sessionId).envState).toBe('stopped'))

    const { run: failed } = await execute([{ type: 'bash', id: 'boom', command: 'exit 1' }], fired)
    expect(failed.status).toBe('failed')
    expect(getSessionRow(failed.sessionId).status).toBe('open')
  })

  it('leaves a session without a boot step up as a code session', async () => {
    const { run } = await execute([{ type: 'bash', id: 'noop', command: 'true' }])
    const session = db.select().from(schema.sessions).where(eq(schema.sessions.id, run.sessionId)).get()!
    expect(session.envState).toBe('up')
    expect(session.tier).toBe('code')
    expect(startEnvStack).not.toHaveBeenCalled()
  })

  it('brings a stopped session back up before a step that runs in its workspace', async () => {
    const step: Step = { type: 'bash', id: 'noop', command: 'true' }
    const { project, run } = await execute([step])
    db.update(schema.sessions).set({ envState: 'stopped' }).where(eq(schema.sessions.id, run.sessionId)).run()
    await startRun(makeRun(project, [step], { sessionId: run.sessionId }).id, project)
    expect(db.select().from(schema.sessions).where(eq(schema.sessions.id, run.sessionId)).get()!.envState).toBe('up')
  })

  it('leaves a stopped code session to its boot step instead of starting a workspace first', async () => {
    const { project, run } = await execute([{ type: 'bash', id: 'noop', command: 'true' }])
    db.update(schema.sessions).set({ envState: 'stopped' }).where(eq(schema.sessions.id, run.sessionId)).run()
    ensureWorkspaceUp.mockClear()
    const states: string[] = []
    removeWorkspace.mockImplementationOnce(async (sessionId: number) => {
      states.push(getSessionRow(sessionId).envState)
    })
    await startRun(makeRun(project, [{ type: 'ddev-start', id: 'boot' }], { sessionId: run.sessionId }).id, project)
    expect(ensureWorkspaceUp).not.toHaveBeenCalled()
    expect(states).toEqual(['stopped'])
    expect(getSessionRow(run.sessionId)).toMatchObject({ envState: 'up', tier: 'preview' })
    startEnvStack.mockClear()
  })

  it('applies a changed environment definition to a code session by dropping its workspace', async () => {
    const step: Step = { type: 'bash', id: 'noop', command: 'true' }
    const { project, run } = await execute([step])
    removeWorkspace.mockClear()
    await startRun(makeRun(project, [step], { sessionId: run.sessionId }).id, { ...project, phpVersion: '8.1' })
    expect(removeWorkspace).toHaveBeenCalledWith(run.sessionId)
    expect(startEnvStack).not.toHaveBeenCalled()
  })

  it('applies a changed environment definition to a preview whose stack is already up', async () => {
    const step: Step = { type: 'bash', id: 'noop', command: 'true' }
    const { project, run } = await execute([step])
    expect(startEnvStack).not.toHaveBeenCalled()
    db.update(schema.sessions).set({ envState: 'up', tier: 'preview' }).where(eq(schema.sessions.id, run.sessionId)).run()
    await startRun(makeRun(project, [step], { sessionId: run.sessionId }).id, project)
    expect(startEnvStack).not.toHaveBeenCalled()
    await startRun(makeRun(project, [step], { sessionId: run.sessionId }).id, { ...project, phpVersion: '8.2' })
    expect(startEnvStack).toHaveBeenCalledWith(run.sessionId, expect.any(Function))
  })

  it('fails the run at a failing step and does not execute later steps', async () => {
    const { run, steps } = await execute([
      { type: 'bash', id: 'boom', command: 'exit 3' },
      { type: 'bash', id: 'never', command: 'echo never' },
    ])
    expect(run.status).toBe('failed')
    expect(steps).toHaveLength(1)
    expect(steps[0]!.status).toBe('failed')
    expect(steps[0]!.outputs?.exitCode).toBe(3)
  })

  it('continues past a failing step with continueOnError, keeping its outputs referencable', async () => {
    const { run, steps } = await execute([
      { type: 'bash', id: 'flaky', command: 'exit 7', continueOnError: true },
      { type: 'bash', id: 'after', command: 'echo code was {{ steps.flaky.exitCode }}' },
    ])
    expect(run.status).toBe('success')
    expect(steps[0]!.status).toBe('failed')
    expect(steps[1]!.status).toBe('success')
    expect(steps[1]!.outputs?.stdout).toBe('code was 7')
  })

  it('retries a failing step and records the attempt count', async () => {
    const { run, steps } = await execute([
      {
        type: 'bash',
        id: 'retry_me',
        command: 'test -f marker || { touch marker; exit 1; }',
        retry: { attempts: 2, backoffSeconds: 0 },
      },
    ])
    expect(run.status).toBe('success')
    expect(steps).toHaveLength(1)
    expect(steps[0]!.status).toBe('success')
    expect(steps[0]!.attempt).toBe(2)
  })

  it('fails a step that exceeds its timeout', async () => {
    const { run, steps } = await execute([
      { type: 'bash', id: 'slow', command: 'sleep 5', timeoutSeconds: 1 },
    ])
    expect(run.status).toBe('failed')
    expect(steps[0]!.status).toBe('failed')
    expect(steps[0]!.error).toContain('timed out')
  })

  it('cancels a running step and marks the run cancelled', async () => {
    const project = makeProject()
    const run = makeRun(project, [{ type: 'bash', id: 'forever', command: 'sleep 30' }])
    const done = startRun(run.id, project)
    for (let i = 0; i < 100 && getSteps(run.id).length === 0; i++) await sleep(50)
    expect(getSteps(run.id).length).toBe(1)
    expect(cancelRun(run.id)).toBe(true)
    await done
    expect(getRun(run.id).status).toBe('cancelled')
    expect(getSteps(run.id)[0]!.status).toBe('cancelled')
  })

  it('counts a run as cancelled even when the cancelled command reports success', async () => {
    const project = makeProject()
    // Like a killed `docker exec` client, which can exit 0 while the command keeps running.
    const run = makeRun(project, [{ type: 'bash', id: 'last', command: 'trap "exit 0" TERM; while true; do sleep 0.1; done' }])
    const done = startRun(run.id, project)
    for (let i = 0; i < 100 && getSteps(run.id).length === 0; i++) await sleep(50)
    await sleep(200)
    cancelRun(run.id)
    await done
    expect(getRun(run.id).status).toBe('cancelled')
    expect(getRun(run.id).log).not.toContain('✓ Done')
    expect(stopRunProcesses).toHaveBeenCalledWith(run.sessionId, run.id)
  })

  it('stops what the cancelled run still runs in the session before it counts as cancelled', async () => {
    const project = makeProject()
    const run = makeRun(project, [{ type: 'bash', id: 'forever', command: 'sleep 30' }])
    let statusWhileStopping: string | undefined
    stopRunProcesses.mockImplementationOnce(async () => {
      statusWhileStopping = getRun(run.id).status
      return true
    })
    const done = startRun(run.id, project)
    for (let i = 0; i < 100 && getSteps(run.id).length === 0; i++) await sleep(50)
    cancelRun(run.id)
    await done
    expect(stopRunProcesses).toHaveBeenCalledWith(run.sessionId, run.id)
    expect(statusWhileStopping).toBe('running')
    expect(getRun(run.id).status).toBe('cancelled')
  })

  it('records each step row\'s byte offset into the run log', async () => {
    // The umlauts force byte and character offsets apart, so counting in characters fails below.
    const { run, steps } = await execute([
      { type: 'bash', id: 'one', command: 'echo grüß gott' },
      { type: 'bash', id: 'two', command: 'echo servus' },
    ])
    expect(run.status).toBe('success')
    const [a, b] = steps
    expect(a!.logStart).toBeGreaterThan(0)
    expect(b!.logStart!).toBeGreaterThan(a!.logStart!)
    const bytes = Buffer.from(run.log, 'utf8')
    for (const row of steps) {
      expect(bytes.subarray(row.logStart!).toString('utf8').startsWith('\n▶ ')).toBe(true)
    }
    const slice = bytes.subarray(a!.logStart!, b!.logStart!).toString('utf8')
    expect(slice).toContain('grüß gott')
    expect(slice).not.toContain('servus')
  })

  it('resumes a retried run after the failing step, replaying earlier outputs', async () => {
    const project = makeProject()
    const run = makeRun(project, [
      { type: 'bash', id: 'first', command: 'echo v1' },
      { type: 'bash', id: 'flaky', command: 'echo replay={{ steps.first.stdout }}; test -f marker || { touch marker; exit 1; }' },
    ])
    await startRun(run.id, project)
    expect(getRun(run.id).status).toBe('failed')

    requeue(run.id)
    await startRun(run.id, project)

    expect(getRun(run.id).status).toBe('success')
    const steps = getSteps(run.id)
    expect(steps.filter(s => s.stepId === 'first')).toHaveLength(1)
    const flaky = steps.filter(s => s.stepId === 'flaky')
    expect(flaky).toHaveLength(1)
    expect(flaky[0]!.status).toBe('success')
    expect(flaky[0]!.params?.command).toContain('echo replay=v1;')
  })

  it('runs again on the session checkout without the uncommitted changes of the failed attempt', async () => {
    const project = makeProject()
    const failed = makeRun(project, [
      { type: 'bash', id: 'work', command: 'echo kept > tracked && git add tracked && git -c user.name=t -c user.email=t@t commit -qm init && echo half > tracked && touch stray && exit 1' },
    ])
    await startRun(failed.id, project)
    expect(getRun(failed.id).status).toBe('failed')

    const again = makeRun(project, [
      { type: 'bash', id: 'check', command: 'cat tracked && test ! -e stray' },
    ], { sessionId: failed.sessionId, resetCheckout: true })
    await startRun(again.id, project)

    expect(getRun(again.id).status).toBe('success')
    expect(getSteps(again.id)[0]!.outputs).toMatchObject({ stdout: 'kept' })
  })

  describe('run again on a failed attempt that committed', () => {
    const commit = (message: string) => `git -c user.name=t -c user.email=t@t commit -qam ${message}`

    async function attempt(failing: string, between?: string) {
      const project = makeProject()
      const origin = mkdtempSync(join(tmpdir(), 'knecht-origin-'))
      execFileSync('git', ['init', '-q', '--bare', origin])
      const setup = makeRun(project, [{
        type: 'bash',
        id: 'setup',
        command: `git remote add origin ${origin} && echo base > tracked && git add tracked && ${commit('base')} && git push -q origin HEAD:refs/heads/main`,
      }])
      await startRun(setup.id, project)
      expect(getRun(setup.id).status).toBe('success')
      const failed = makeRun(project, [{ type: 'bash', id: 'work', command: failing }], { sessionId: setup.sessionId })
      await startRun(failed.id, project)
      expect(getRun(failed.id).status).toBe('failed')
      if (between) {
        const later = makeRun(project, [{ type: 'bash', id: 'later', command: between }], { sessionId: setup.sessionId })
        await startRun(later.id, project)
        expect(getRun(later.id).status).toBe('success')
      }
      const { startSha, endSha } = getRun(failed.id)
      const again = makeRun(project, [
        { type: 'bash', id: 'check', command: 'test ! -e stray && cat tracked && git log --format=%s' },
      ], { sessionId: setup.sessionId, resetCheckout: true, startSha, endSha })
      await startRun(again.id, project)
      expect(getRun(again.id).status).toBe('success')
      return { origin, failed: getRun(failed.id), again: getRun(again.id), stdout: getSteps(again.id)[0]!.outputs?.stdout }
    }

    it('starts from the commit the failed attempt started on', async () => {
      const { failed, again, stdout } = await attempt(`echo attempt > tracked && ${commit('attempt')} && echo half > tracked && touch stray && exit 1`)
      expect(failed.startSha).toMatch(/^[0-9a-f]{40}$/)
      expect(stdout).toBe('base\nbase')
      expect(again.startSha).toBe(failed.startSha)
    })

    it('keeps the commits the failed attempt already pushed', async () => {
      const { origin, again, stdout } = await attempt(`echo pushed > tracked && ${commit('pushed')} && git push -q origin HEAD:refs/heads/main && echo local > tracked && ${commit('local')} && exit 1`)
      expect(stdout).toBe('pushed\npushed\nbase')
      expect(again.startSha).toBe(execFileSync('git', ['rev-parse', 'main'], { cwd: origin, encoding: 'utf8' }).trim())
    })

    it('keeps the copied end of the attempt when the run fails before it has a checkout', async () => {
      const project = makeProject()
      const session = makeSession(project, { envState: 'stopped' })
      ensureWorkspaceUp.mockRejectedValueOnce(new Error('no workspace'))
      const again = makeRun(project, [{ type: 'bash', id: 'check', command: 'true' }], { sessionId: session.id, resetCheckout: true, startSha: 'a1b2c3', endSha: 'd4e5f6' })
      await startRun(again.id, project)
      expect(getRun(again.id)).toMatchObject({ status: 'failed', endSha: 'd4e5f6' })
    })

    it('keeps the commits later work made after the failed attempt ended', async () => {
      const { stdout } = await attempt(
        `echo attempt > tracked && ${commit('attempt')} && exit 1`,
        `echo later > tracked && ${commit('later')}`,
      )
      expect(stdout).toBe('later\nlater\nattempt\nbase')
    })
  })

  it('takes the matching if branch and tags sub-steps with the parent step', async () => {
    const { run, steps } = await execute([
      {
        type: 'if',
        id: 'gate',
        conditions: [[{ left: '{{ inputs.mode }}', op: 'eq', right: 'fast' }]],
        then: [{ type: 'bash', id: 'then_step', command: 'echo yes' }],
        else: [{ type: 'bash', id: 'else_step', command: 'echo no' }],
      },
    ], { inputs: { mode: 'fast' } })
    expect(run.status).toBe('success')
    const gate = steps.find(s => s.stepId === 'gate')!
    expect(gate.outputs).toEqual({ matched: true })
    const thenRow = steps.find(s => s.stepId === 'then_step')!
    expect(thenRow.parentStepId).toBe('gate')
    expect(steps.find(s => s.stepId === 'else_step')).toBeUndefined()
  })

  it('iterates a loop, exposing loop.index and collecting per-iteration outputs', async () => {
    const { run, steps } = await execute([
      {
        type: 'loop',
        id: 'thrice',
        items: '3',
        steps: [{ type: 'bash', id: 'say', command: 'echo item {{ loop.index }}' }],
      },
    ])
    expect(run.status).toBe('success')
    const iterations = steps.filter(s => s.stepId === 'say')
    expect(iterations.map(s => s.iteration)).toEqual([0, 1, 2])
    expect(iterations.map(s => s.outputs?.stdout)).toEqual(['item 0', 'item 1', 'item 2'])
    const loop = steps.find(s => s.stepId === 'thrice')!
    expect(loop.outputs?.count).toBe(3)
    expect(loop.outputs?.results).toHaveLength(3)
  })

  it('runs js steps in the sandbox and passes a single-ref input as the raw value', async () => {
    const { run, steps } = await execute([
      { type: 'js', id: 'one', code: 'function main() { return { n: 21 } }' },
      { type: 'js', id: 'two', code: 'function main(input) { return { doubled: input.n * 2 } }', input: '{{ steps.one.result }}' },
    ])
    expect(run.status).toBe('success')
    expect(steps[0]!.outputs?.result).toEqual({ n: 21 })
    expect((steps[1]!.outputs?.result as { doubled: number }).doubled).toBe(42)
  })

  it('rejects step outputs above the size cap with an actionable error', async () => {
    const { run, steps } = await execute([
      { type: 'js', id: 'huge', code: 'function main() { return "x".repeat(70000) }' },
    ])
    expect(run.status).toBe('failed')
    expect(steps[0]!.error).toContain('outputs too large')
  })

  it('creates a real branch and commit in the run worktree via the git steps', async () => {
    const { run, steps } = await execute([
      { type: 'create-branch', id: 'branch', name: 'knecht/test-{{ run.id }}' },
      { type: 'bash', id: 'change', command: 'echo change > file.txt' },
      { type: 'create-commit', id: 'commit', message: 'Test change (run {{ run.id }})' },
    ])
    expect(run.status).toBe('success')
    expect(run.branch).toBe(`knecht/test-${run.id}`)
    const commit = steps.find(s => s.stepId === 'commit')!
    expect(commit.outputs?.created).toBe(true)
    expect(commit.outputs?.sha).toMatch(/^[0-9a-f]{40}$/)
    const { execa } = await import('execa')
    const { stdout } = await execa('git', ['-C', checkoutDirOf(run.sessionId), 'log', '-1', '--format=%s %an'])
    expect(stdout).toBe(`Test change (run ${run.id}) Knecht Test`)
  })

  it('keeps the work branch of the session instead of branching off it', async () => {
    const project = makeProject()
    const session = makeSession(project, { branch: 'feature/checkout' })
    const queued = makeRun(project, [{ type: 'create-branch', id: 'branch', name: 'knecht/review-{{ run.id }}' }], { sessionId: session.id })
    await startRun(queued.id, project)
    const run = getRun(queued.id)
    const steps = getSteps(queued.id)
    expect(run.status).toBe('success')
    expect(run.branch).toBe('feature/checkout')
    expect(steps[0]!.outputs).toMatchObject({ name: 'feature/checkout' })
    expect(getSessionRow(session.id).branch).toBe('feature/checkout')
  })

  it('branches off a session that sits on its base branch', async () => {
    const project = makeProject()
    const session = makeSession(project, { branch: 'develop', baseBranch: 'develop' })
    const queued = makeRun(project, [{ type: 'create-branch', id: 'branch', name: 'knecht/fix-{{ run.id }}' }], { sessionId: session.id })
    await startRun(queued.id, project)
    expect(getRun(queued.id).branch).toBe(`knecht/fix-${queued.id}`)
    expect(getSessionRow(session.id)).toMatchObject({ branch: `knecht/fix-${queued.id}`, baseBranch: 'develop' })
  })

  it('branches off a session on the default branch even when its base is another branch', async () => {
    const project = makeProject()
    const session = makeSession(project, { branch: 'main', baseBranch: 'release' })
    const queued = makeRun(project, [{ type: 'create-branch', id: 'branch', name: 'knecht/fix-{{ run.id }}' }], { sessionId: session.id })
    await startRun(queued.id, project)
    expect(getRun(queued.id).branch).toBe(`knecht/fix-${queued.id}`)
    expect(getSessionRow(session.id).branch).toBe(`knecht/fix-${queued.id}`)
  })
})
