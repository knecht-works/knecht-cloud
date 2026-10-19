import type { z } from 'zod'
import { recordToolCall } from '../stores/tool-calls'

export type Actor = { kind: 'member', login: string } | { kind: 'system' }

export interface ToolContext {
  actor: Actor
  channel: 'dashboard' | 'mcp' | 'daemon'
}

export interface Tool<I extends z.ZodType = z.ZodType, O = unknown> {
  name: string
  description: string
  scope: `${string}:${'read' | 'write'}`
  input: I
  run: (input: z.output<I>, ctx: ToolContext) => O | Promise<O>
}

export function defineTool<I extends z.ZodType, O>(tool: Tool<I, O>): Tool<I, O> {
  return tool
}

export function isWriteTool(tool: Tool): boolean {
  return tool.scope.endsWith(':write')
}

export class ToolDeniedError extends Error {}

export async function callTool<I extends z.ZodType, O>(tool: Tool<I, O>, input: z.input<I>, ctx: ToolContext): Promise<O> {
  const started = performance.now()
  let error: string | null = null
  try {
    if (ctx.actor.kind === 'system' && isWriteTool(tool as Tool)) {
      throw new ToolDeniedError(`The system may not call ${tool.name}: it writes`)
    }
    return await tool.run(tool.input.parse(input), ctx)
  }
  catch (e) {
    error = (e as Error).message
    throw e
  }
  finally {
    recordToolCall({
      actor: ctx.actor.kind === 'member' ? ctx.actor.login : null,
      channel: ctx.channel,
      tool: tool.name,
      input,
      error,
      durationMs: Math.round(performance.now() - started),
    })
  }
}
