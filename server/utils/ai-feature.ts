import { generateText, Output, stepCountIs, tool } from 'ai'
import type { z } from 'zod'
import { callTool, isWriteTool, type Tool, type ToolContext } from '../tools/registry'
import { languageModel, type ModelRole } from './llm'

export interface AiFeature<O extends z.ZodType> {
  id: string
  model: ModelRole
  instructions: string
  tools: Tool[]
  output: O
  maxSteps: number
}

// The tools read logs, tickets and repo content anyone can write to, so a loop never
// writes itself: a feature that changes something returns a proposal the member confirms.
export function defineAiFeature<O extends z.ZodType>(feature: AiFeature<O>): AiFeature<O> {
  const writer = feature.tools.find(isWriteTool)
  if (writer) throw new Error(`AI feature ${feature.id} may not use ${writer.name}: it writes`)
  return feature
}

export async function runAiFeature<O extends z.ZodType>(
  feature: AiFeature<O>,
  prompt: string,
  ctx: ToolContext,
  options: { maxOutputTokens?: number, abortSignal?: AbortSignal } = {},
): Promise<z.output<O>> {
  const tools = Object.fromEntries(feature.tools.map(t => [t.name, tool({
    description: t.description,
    inputSchema: t.input,
    execute: input => callTool(t, input, ctx),
  })]))
  const result = await generateText({
    model: await languageModel(feature.model),
    instructions: feature.instructions,
    prompt,
    tools,
    stopWhen: stepCountIs(feature.maxSteps),
    // A model still calling tools at the limit would end without the structured answer.
    prepareStep: ({ stepNumber }) => stepNumber === feature.maxSteps - 1 ? { toolChoice: 'none' } : undefined,
    output: Output.object({ schema: feature.output }),
    ...options,
  })
  const toolNames = result.steps.flatMap(s => s.toolCalls.map(c => c.toolName))
  console.info(`[ai:${feature.id}] ${result.steps.length} steps, tools: ${toolNames.join(', ') || 'none'}, tokens: ${result.totalUsage.inputTokens ?? '?'} in / ${result.totalUsage.outputTokens ?? '?'} out`)
  return result.output as z.output<O>
}
