import { z } from 'zod'
import type { Project } from '#server/db/schema'
import type { Step } from '#shared/utils/workflow'
import type { RunContext } from '#server/workflows/context'
import type { SandboxProcess } from '#server/daemon/sandbox-process'

export interface ActionRuntime {
  runId: number
  sessionId: number
  project: Project
  checkoutDir: string
  ctx: RunContext
  log: (text: string) => void
  signal: AbortSignal
  sandbox: {
    /** The checkout's path inside the sandbox, not on the host. */
    projectDir: string
    ensureUp: () => Promise<void>
    /** Never boots the preview: runs in it when it is up, else in a workspace that `release` removes. */
    withoutPreview: () => Promise<{ stream: ActionRuntime['sandbox']['stream'], exec: ActionRuntime['sandbox']['exec'], release: () => Promise<void> }>
    /** `env` never appears in the command line (secrets). */
    stream: (command: string[], opts?: { env?: Record<string, string> }) => Promise<{ code: number, tail: string }>
    /** Resolves to the raw stdout, rejects on a non-zero exit. */
    exec: (command: string[], opts?: { env?: Record<string, string>, input?: string | Uint8Array }) => Promise<string>
    spawn: (command: string[], opts?: { env?: Record<string, string> }) => SandboxProcess
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
  /** Left as templates for the action to render from `rt.ctx` with its own escaping. */
  templateParams?: readonly string[]
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
