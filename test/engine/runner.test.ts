import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import type { Step } from '../../shared/utils/workflow'
import { checkoutDirOf } from '../helpers/local-sandbox'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import { getRun, getSteps, makeProject, makeRun, requeue } from '../helpers/db'

vi.mock('../../server/daemon/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/daemon/git')>()
  const { fakeCheckout } = await import('../helpers/local-sandbox')
  return { ...actual, prepareSessionCheckout: fakeCheckout }
})
const startEnvStack = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../server/daemon/sandbox', async () => {
  const { execInSandbox, copyIntoSandbox, streamInSandbox, spawnInSandbox } = await import('../helpers/local-sandbox')
  return { execInSandbox, copyIntoSandbox, streamInSandbox, spawnInSandbox, startEnvStack, WEB_PROJECT_DIR: '/var/www/html' }
})
vi.mock('../../server/daemon/envs', () => ({ ensureEnvUp: async () => {} }))
vi.mock('../../server/utils/github-app', () => ({
  getInstallationToken: async () => 'test-token',
  getBotIdentity: async () => ({ name: 'Knecht Test', email: 'test@knecht.works' }),
}))
const jiraComments = vi.hoisted(() => [] as { key: string, text: string }[])
vi.mock('../../server/integrations/jira/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../server/integrations/jira/api')>(),
  addJiraComment: async (key: string, body: { content?: { content?: { text?: string, marks?: unknown }[] }[] }) => {
    jiraComments.push({ key, text: (body.content?.[0]?.content ?? []).map(n => n.text ?? '').join('') })
    return { url: 'https://x' }
  },
}))

const { startRun, cancelRun } = await import('../../server/daemon/runner')

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
      db.update(schema.sessions).set({ objectIntegration: 'jira', objectKind: 'issue', objectKey: `PROJ-${++n}` }).where(eq(schema.sessions.id, run.sessionId)).run()
      return run
    }

    await startRun(ticket({ prUrl: 'https://x/pull/4' }).id, project)
    expect(jiraComments.at(-1)).toEqual({ key: 'PROJ-1', text: 'Knecht opened a pull request for this ticket: https://x/pull/4' })

    jiraComments.length = 0
    await startRun(ticket({}).id, project)
    expect(jiraComments).toHaveLength(0)

    const failed = ticket({ status: 'failed' })
    await startRun(failed.id, project)
    expect(getRun(failed.id).status).toBe('failed')
    expect(jiraComments.at(-1)?.text).toContain(`Knecht could not finish the run for this ticket: http://knecht.test/projects/${project.id}?run=${failed.id}`)

    const silent = db.insert(schema.workflows).values({ name: 'silent-jira', steps: [], repliesEnabled: false }).returning().get()
    jiraComments.length = 0
    await startRun(ticket({ prUrl: 'https://x/pull/5', workflowId: silent.id }).id, project)
    expect(jiraComments).toHaveLength(0)
  })

  it('runs a linear workflow and passes outputs between steps', async () => {
    const { run, steps } = await execute([
      { type: 'bash', id: 'greet', command: 'echo hello' },
      { type: 'bash', id: 'use', command: 'echo got: {{ steps.greet.stdout }}' },
    ])
    expect(run.status).toBe('success')
    const { getSessionRow } = await import('../helpers/db')
    expect(getSessionRow(run.sessionId).status).toBe('closed')
    expect(steps).toHaveLength(2)
    expect(steps.every(s => s.status === 'success')).toBe(true)
    expect(steps[1]!.params?.command).toBe('echo got: hello')
    expect(steps[1]!.outputs?.stdout).toBe('got: hello')
  })

  it('applies a changed environment definition to a session whose stack is already up', async () => {
    const step: Step = { type: 'bash', id: 'noop', command: 'true' }
    const { project, run } = await execute([step])
    expect(startEnvStack).not.toHaveBeenCalled()
    db.update(schema.sessions).set({ envState: 'up' }).where(eq(schema.sessions.id, run.sessionId)).run()
    await startRun(makeRun(project, [step], { sessionId: run.sessionId }).id, project)
    expect(startEnvStack).not.toHaveBeenCalled()
    await startRun(makeRun(project, [step], { sessionId: run.sessionId }).id, { ...project, phpVersion: '8.2' })
    expect(startEnvStack).toHaveBeenCalledWith(run.sessionId)
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
})
