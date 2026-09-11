import { z } from 'zod'
import type { Project } from '../../db/schema'
import type { Step } from '../../../shared/utils/workflow'
import type { RunContext } from '../context'

export interface ActionRuntime {
  runId: number
  sessionId: number
  project: Project
  checkoutDir: string
  ctx: RunContext
  log: (text: string) => void
  signal: AbortSignal
  sandbox: {
    ensureUp: () => Promise<void>
    /** `env` never appears in the command line (secrets). */
    stream: (command: string[], opts?: { env?: Record<string, string> }) => Promise<{ code: number, tail: string }>
    copyIn: (hostPath: string, sandboxPath: string) => Promise<void>
  }
}

export class ActionError extends Error {
  outputs?: Record<string, unknown>
  constructor(message: string, outputs?: Record<string, unknown>) {
    super(message)
    this.outputs = outputs
  }
}

export interface ActionDef<T extends Step['type']> {
  type: T
  params: z.ZodRawShape
  yaml?: z.ZodType<Step>
  legacyKey?: string
  rawParams?: readonly string[]
  run(step: Extract<Step, { type: T }>, rt: ActionRuntime): Promise<Record<string, unknown> | undefined>
}

export type RegisteredAction = Omit<ActionDef<Step['type']>, 'yaml'> & { yaml: z.ZodType<Step> }

export function defineAction<T extends Step['type']>(def: ActionDef<T>): RegisteredAction {
  return { yaml: defaultYaml(def.type, def.params), ...def } as unknown as RegisteredAction
}

function defaultYaml(type: Step['type'], params: z.ZodRawShape): z.ZodType<Step> {
  if (!Object.keys(params).length) {
    return z.literal(type).transform(() => ({ type }) as Step)
  }
  return z.object({ [type]: z.object(params) })
    .transform(o => ({ type, ...(o as Record<string, object>)[type] }) as Step)
}
