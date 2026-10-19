import { describe, expect, it } from 'vitest'
import { appendRunLog } from '../../server/stores/runs'
import { createRunStep, readStepLog } from '../../server/stores/run-steps'
import { createWorkflow } from '../../server/stores/workflows'
import { callTool, type ToolContext } from '../../server/tools/registry'
import { getRunLogTool, getRunTool, getStepLogTool, listRunsTool } from '../../server/tools/runs'
import { getWorkflowTool } from '../../server/tools/workflows'
import { makeProject, makeRun } from '../helpers/db'

const system: ToolContext = { actor: { kind: 'system' }, channel: 'daemon' }

describe('run tools', () => {
  it('slices a step\'s log by byte offsets', async () => {
    const run = makeRun(makeProject(), [])
    appendRunLog(run.id, 'größe\n')
    const first = createRunStep({ runId: run.id, stepIndex: 0, stepId: 'a', type: 'bash', logStart: 8 })
    appendRunLog(run.id, 'a ok\n')
    const second = createRunStep({ runId: run.id, stepIndex: 1, stepId: 'b', type: 'bash', logStart: 13 })
    appendRunLog(run.id, '\x1B[31mb failed\x1B[0m\n')

    expect(readStepLog(run.id, first)).toBe('a ok\n')
    expect(await callTool(getStepLogTool, { runId: run.id, stepId: second }, system)).toEqual({ text: 'b failed\n', omittedChars: 0 })
    expect(await callTool(getStepLogTool, { runId: run.id, stepId: second, maxChars: 3 }, system)).toEqual({ text: 'ed\n', omittedChars: 6 })
    await expect(callTool(getStepLogTool, { runId: run.id + 1, stepId: second }, system)).rejects.toThrow('No log')
  })

  it('masks http header values in step params', async () => {
    const run = makeRun(makeProject(), [])
    createRunStep({ runId: run.id, stepIndex: 0, stepId: 'call', type: 'http', params: { url: 'https://x', headers: 'Authorization: Bearer secret' } })
    const { steps } = await callTool(getRunTool, { runId: run.id }, system)
    expect(steps[0]!.params).toEqual({ url: 'https://x', headers: 'Authorization: ***' })
  })

  it('filters runs by project and status', async () => {
    const project = makeProject()
    const failed = makeRun(project, [], { status: 'failed' })
    makeRun(project, [], { status: 'success' })
    makeRun(makeProject(), [], { status: 'failed' })
    const runs = await callTool(listRunsTool, { projectId: project.id, status: 'failed' }, system)
    expect(runs.map(r => r.id)).toEqual([failed.id])
  })
})

describe('workflow tools', () => {
  it('returns the published version and the draft as YAML documents', async () => {
    const w = createWorkflow({
      name: 'tools-test',
      steps: [{ type: 'bash', command: 'echo live' }, { type: 'http', method: 'GET', url: 'https://x.test', headers: 'Authorization: Bearer secret' }],
      draftSteps: [{ type: 'bash', command: 'echo draft' }],
      publishedAt: new Date(),
    })
    const result = await callTool(getWorkflowTool, { workflowId: w.id }, system)
    expect(result.published).toContain('echo live')
    expect(result.published).toContain('Authorization: ***')
    expect(result.published).not.toContain('secret')
    expect(result.draft).toContain('echo draft')
  })
})

describe('get_run_log', () => {
  it('returns the end of the whole log', async () => {
    const run = makeRun(makeProject(), [])
    appendRunLog(run.id, 'preparing\n\x1B[31mddev start failed\x1B[0m\n')
    expect(await callTool(getRunLogTool, { runId: run.id, maxBytes: 27 }, system)).toEqual({ text: 'ddev start failed\n', omittedBytes: 10 })
  })
})
