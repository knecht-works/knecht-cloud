import { describe, expect, it } from 'vitest'
import { buildDiagnosisPrompt, type DiagnosisStep } from '../../server/utils/run-diagnosis'

function step(over: Partial<DiagnosisStep>): DiagnosisStep {
  return { id: 1, stepId: 's', type: 'bash', status: 'success', error: null, params: null, iteration: null, attempt: 1, ...over }
}

function run(steps: DiagnosisStep[], workflowId: number | null = 4) {
  return { id: 12, workflow: 'CI', workflowId, steps }
}

describe('buildDiagnosisPrompt', () => {
  it('lists every step by id and gives failed steps their params and log', () => {
    const prompt = buildDiagnosisPrompt(run([
      step({ id: 7, stepId: 'install' }),
      step({ id: 8, stepId: 'test', status: 'failed', error: 'exit code 1', params: { command: 'npm test' } }),
    ]), new Map([[8, 'FAIL foo.test.ts']]))
    expect(prompt).toContain('Run id: 12\n\nWorkflow: CI (id 4)')
    expect(prompt).toContain('- [7] install (bash): success')
    expect(prompt).toContain('- [8] test (bash): failed, error: exit code 1')
    expect(prompt).toContain('## Failed step [8] test (bash)')
    expect(prompt).toContain('"command": "npm test"')
    expect(prompt).toContain('Log:\nFAIL foo.test.ts')
  })

  it('uses the run log tail when no step failed', () => {
    const prompt = buildDiagnosisPrompt(run([], null), new Map(), 'ddev start failed\n')
    expect(prompt).toContain('Workflow: CI\n')
    expect(prompt).toContain('- none ran')
    expect(prompt).toContain('## Log tail\n\nddev start failed')
  })

  it('tells loop iterations and retries apart', () => {
    const prompt = buildDiagnosisPrompt(run([
      step({ id: 3, stepId: 'build', status: 'failed', iteration: 1, attempt: 2 }),
    ]), new Map([[3, '']]))
    expect(prompt).toContain('## Failed step [3] build #2 (bash, attempt 2)')
    expect(prompt).toContain('(no log captured)')
  })

  it('truncates oversized params', () => {
    const prompt = buildDiagnosisPrompt(run([step({ status: 'failed', params: { command: 'x'.repeat(5000) } })]), new Map([[1, 'log']]))
    expect(prompt).toContain('[... truncated]')
    expect(prompt.length).toBeLessThan(2_500)
  })
})
