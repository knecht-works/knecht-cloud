import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { MockLanguageModelV4 } from 'ai/test'
import { db, schema } from '../../server/db'
import { appendRunLog } from '../../server/stores/runs'
import { createRunStep } from '../../server/stores/run-steps'
import { defineTool } from '../../server/tools/registry'
import { getStepLogTool } from '../../server/tools/runs'
import { makeProject, makeRun } from '../helpers/db'

let model: MockLanguageModelV4
vi.mock('../../server/utils/llm', () => ({ languageModel: async () => model }))

const { defineAiFeature, runAiFeature } = await import('../../server/utils/ai-feature')

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}
const toolCall = (toolName: string, input: unknown) => ({
  content: [{ type: 'tool-call' as const, toolCallId: 'c1', toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const, raw: undefined },
  usage,
  warnings: [],
})
const answer = (output: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(output) }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage,
  warnings: [],
})

const feature = defineAiFeature({
  id: 'test',
  model: 'fast',
  instructions: 'Find the cause.',
  tools: [getStepLogTool],
  output: z.object({ cause: z.string() }),
  maxSteps: 3,
})

describe('runAiFeature', () => {
  it('lets the model call registry tools as the given actor before it answers', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const run = makeRun(makeProject(), [], { status: 'failed' })
    const step = createRunStep({ runId: run.id, stepIndex: 0, stepId: 'install', type: 'bash', status: 'success', logStart: 0 })
    appendRunLog(run.id, 'wrote wrong .env\n')
    model = new MockLanguageModelV4({ doGenerate: [toolCall('get_step_log', { runId: run.id, stepId: step }), answer({ cause: '.env' })] })

    const output = await runAiFeature(feature, `Run ${run.id} failed.`, { actor: { kind: 'system' }, channel: 'daemon' })

    expect(output).toEqual({ cause: '.env' })
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain('wrote wrong .env')
    const calls = db.select().from(schema.toolCalls).where(eq(schema.toolCalls.tool, 'get_step_log')).all()
      .filter(c => (c.input as { runId?: number }).runId === run.id)
    expect(calls).toHaveLength(1)
  })

  it('takes the tools away on the last step so the model has to answer', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const call = toolCall('get_step_log', { runId: 0, stepId: 0 })
    model = new MockLanguageModelV4({ doGenerate: [call, call, answer({ cause: 'unknown' })] })

    await runAiFeature(feature, 'x', { actor: { kind: 'system' }, channel: 'daemon' })

    expect(model.doGenerateCalls.map(c => c.toolChoice?.type)).toEqual(['auto', 'auto', 'none'])
  })

  it('refuses a feature that offers a writing tool', () => {
    const writer = defineTool({ name: 'delete_run', description: '', scope: 'runs:write', input: z.object({}), run: () => null })
    expect(() => defineAiFeature({ ...feature, tools: [writer] })).toThrow('may not use delete_run')
  })
})
