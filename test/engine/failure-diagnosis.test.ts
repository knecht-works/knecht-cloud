import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../server/db'
import { appendRunLog, requeueRun } from '../../server/stores/runs'
import { createRunStep } from '../../server/stores/run-steps'
import { makeProject, makeRun, getRun } from '../helpers/db'

const generateText = vi.fn()
vi.mock('ai', async importOriginal => ({ ...await importOriginal<typeof import('ai')>(), generateText: (...args: unknown[]) => generateText(...args) }))
vi.mock('../../server/utils/llm', () => ({ languageModel: async () => ({}) }))
vi.mock('../../server/utils/settings', () => ({ getSettings: () => ({ aiKeyEnc: 'enc', aiModel: 'm' }) }))

const { diagnoseRunFailure } = await import('../../server/daemon/failure-diagnosis')

function failedRun() {
  const run = makeRun(makeProject(), [], { status: 'failed', workflow: 'CI' })
  const ok = createRunStep({ runId: run.id, stepIndex: 0, stepId: 'install', type: 'bash', status: 'success', logStart: 0 })
  appendRunLog(run.id, 'installed\n')
  const bad = createRunStep({ runId: run.id, stepIndex: 1, stepId: 'test', type: 'bash', status: 'failed', error: 'exit code 1', logStart: 10 })
  appendRunLog(run.id, 'FAIL foo.test.ts\n')
  return { run, ok, bad }
}

describe('diagnoseRunFailure', () => {
  beforeEach(() => {
    generateText.mockReset()
  })

  it('reads the run through audited system tool calls and stores the summary with step links', async () => {
    const { run, bad } = failedRun()
    generateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
      expect(getRun(run.id).failureDiagnosis).toEqual({ state: 'pending' })
      expect(prompt).toContain('FAIL foo.test.ts')
      return { output: { summary: '  A test fails.  ', stepIds: [bad, 999] } }
    })
    await diagnoseRunFailure(run.id)
    expect(getRun(run.id).failureDiagnosis).toEqual({ state: 'done', summary: 'A test fails.', steps: [{ id: bad, label: 'test' }] })
    const calls = db.select().from(schema.toolCalls).where(eq(schema.toolCalls.channel, 'daemon')).all()
      .filter(c => (c.input as { runId?: number }).runId === run.id)
    expect(calls.map(c => [c.tool, c.actor])).toEqual([['get_run', null], ['get_step_log', null]])
  })

  it('links the failed steps when the model cites none', async () => {
    const { run, bad } = failedRun()
    generateText.mockResolvedValue({ output: { summary: 'x', stepIds: [] } })
    await diagnoseRunFailure(run.id)
    expect(getRun(run.id).failureDiagnosis).toMatchObject({ steps: [{ id: bad }] })
  })

  it('clears the pending state when the model call fails', async () => {
    const { run } = failedRun()
    generateText.mockRejectedValue(new Error('rate limited'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await diagnoseRunFailure(run.id)
    expect(getRun(run.id).failureDiagnosis).toBeNull()
  })

  it('drops a diagnosis that arrives after the run was retried', async () => {
    const { run } = failedRun()
    generateText.mockImplementation(async () => {
      requeueRun(run.id)
      return { output: { summary: 'stale', stepIds: [] } }
    })
    await diagnoseRunFailure(run.id)
    expect(getRun(run.id).failureDiagnosis).toBeNull()
  })
})
