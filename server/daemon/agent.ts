import { Readable, Writable } from 'node:stream'
import { client, methods, ndJsonStream, PROTOCOL_VERSION, type ClientConnection, type PermissionOption, type SessionUpdate, type StopReason, type ToolCallUpdate, type ToolKind } from '@agentclientprotocol/sdk'
import type { SandboxProcess } from './sandbox-process'

export interface AgentTurn {
  text: string
  stopReason: StopReason
}

export interface AgentSession {
  readonly sessionId: string
  readonly loaded: boolean
  prompt: (text: string) => Promise<AgentTurn>
  close: () => Promise<void>
}

interface OpenAgentOptions {
  process: SandboxProcess
  cwd: string
  log: (text: string) => void
  signal: AbortSignal
  /** Resume this agent session; falls back to a new one when the agent no longer knows it. */
  sessionId?: string | null
}

const CANCEL_GRACE_MS = 10_000
const STDERR_TAIL = 4 * 1024

const KIND_LABEL: Record<ToolKind, string> = {
  read: 'read',
  edit: 'edit',
  delete: 'delete',
  move: 'move',
  search: 'search',
  execute: 'run',
  think: 'think',
  fetch: 'fetch',
  switch_mode: 'mode',
  other: 'tool',
}

// One agent process, one ACP session; the turn's last message is the reply callers get back.
export async function openAgent(opts: OpenAgentOptions): Promise<AgentSession> {
  const { process: proc, log } = opts
  let stderr = ''
  proc.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL)
  })
  let exitCode: number | null = null
  const exitError = () => new Error(`agent exited with code ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)
  const exited = proc.exited.then((code) => {
    exitCode = code
    throw exitError()
  })
  // The connection notices the closed pipe before the exit code arrives; the exit is the better message.
  const untilExit = async <T>(p: Promise<T>): Promise<T> => {
    try {
      return await Promise.race([p, exited])
    }
    catch (e) {
      await Promise.race([proc.exited, new Promise(resolve => setTimeout(resolve, 200))])
      throw exitCode === null ? e : exitError()
    }
  }

  let turn: Turn | null = null

  const connection: ClientConnection = client({ name: 'knecht' })
    .onRequest(methods.client.session.requestPermission, ({ params }) => ({
      outcome: { outcome: 'selected' as const, optionId: allowOption(params.options).optionId },
    }))
    .onNotification(methods.client.session.update, ({ params }) => {
      if (turn && params.sessionId === turn.sessionId) turn.apply(params.update)
    })
    .connect(ndJsonStream(
      Writable.toWeb(proc.stdin as NodeJS.WritableStream & Writable) as WritableStream<Uint8Array>,
      Readable.toWeb(proc.stdout as NodeJS.ReadableStream & Readable) as ReadableStream<Uint8Array>,
    ))
  const agent = connection.agent
  const close = async () => {
    connection.close()
    proc.kill()
    await proc.exited
  }

  let sessionId: string
  let loaded = false
  try {
    await untilExit(agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'knecht', version: '1' },
      clientCapabilities: {},
    }))
    if (opts.sessionId) {
      try {
        await untilExit(agent.request(methods.agent.session.load, { sessionId: opts.sessionId, cwd: opts.cwd, mcpServers: [] }))
        sessionId = opts.sessionId
        loaded = true
      }
      catch (e) {
        log(`\nCould not resume the agent session, starting a new one: ${(e as Error).message}\n`)
      }
    }
    if (!loaded) {
      const created = await untilExit(agent.request(methods.agent.session.new, { cwd: opts.cwd, mcpServers: [] }))
      sessionId = created.sessionId
    }
  }
  catch (e) {
    await close()
    throw e
  }

  return {
    sessionId: sessionId!,
    loaded,
    async prompt(text) {
      turn = new Turn(sessionId, log)
      const onAbort = () => {
        void agent.notify(methods.agent.session.cancel, { sessionId })
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
      try {
        if (opts.signal.aborted) throw new Error('Cancelled')
        const response = await untilExit(Promise.race([
          agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text }] }),
          killAfterCancel(opts.signal, proc),
        ]))
        turn.finish()
        if (response.stopReason === 'cancelled' || opts.signal.aborted) throw new Error('Cancelled')
        return { text: turn.reply(), stopReason: response.stopReason }
      }
      finally {
        opts.signal.removeEventListener('abort', onAbort)
        turn = null
      }
    },
    close,
  }
}

// A cancel the agent never answers must not hang the run forever.
function killAfterCancel(signal: AbortSignal, proc: SandboxProcess): Promise<never> {
  return new Promise((_, reject) => {
    const arm = () => setTimeout(() => {
      proc.kill()
      reject(new Error('Cancelled'))
    }, CANCEL_GRACE_MS)
    if (signal.aborted) arm()
    else signal.addEventListener('abort', arm, { once: true })
  })
}

// A shell call's location is its working directory, which says nothing about the call.
function toolLabel(tool: ToolCallUpdate): string {
  const title = tool.title?.trim() || tool.name || 'tool'
  const path = tool.kind === 'execute' ? undefined : tool.locations?.[0]?.path
  return path && !title.includes(path) ? `${title} ${path}` : title
}

function withoutNulls<T extends object>(update: T): Partial<T> {
  return Object.fromEntries(Object.entries(update).filter(([, v]) => v != null)) as Partial<T>
}

function allowOption(options: PermissionOption[]): PermissionOption {
  return options.find(o => o.kind === 'allow_always')
    ?? options.find(o => o.kind === 'allow_once')
    ?? options[0]!
}

class Turn {
  private messages: string[] = ['']
  private messageId: string | null | undefined
  private atLineStart = true
  private tools = new Map<string, ToolCallUpdate>()

  constructor(readonly sessionId: string, private readonly log: (text: string) => void) {}

  apply(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        if (update.content.type !== 'text') return
        if (update.messageId !== this.messageId) {
          this.messageId = update.messageId
          if (this.messages.at(-1)) this.messages.push('')
        }
        this.messages[this.messages.length - 1] += update.content.text
        this.write(update.content.text)
        return
      }
      // Logged once finished: a shell call's title is only the command after its input arrived.
      case 'tool_call':
      case 'tool_call_update': {
        const known = this.tools.get(update.toolCallId) ?? { toolCallId: update.toolCallId }
        const merged: ToolCallUpdate = { ...known, ...withoutNulls(update), toolCallId: update.toolCallId }
        this.tools.set(update.toolCallId, merged)
        if (merged.status === 'completed' || merged.status === 'failed') {
          this.tools.delete(update.toolCallId)
          this.line(`${merged.status === 'failed' ? 'failed ' : ''}${KIND_LABEL[merged.kind ?? 'other']}: ${toolLabel(merged)}`)
        }
        return
      }
      default:
    }
  }

  finish(): void {
    if (!this.atLineStart) this.write('\n')
  }

  reply(): string {
    const last = [...this.messages].reverse().find(m => m.trim())
    return (last ?? '').trim()
  }

  private line(text: string): void {
    this.write(`${this.atLineStart ? '' : '\n'}${text}\n`)
  }

  private write(text: string): void {
    if (!text) return
    this.log(text)
    this.atLineStart = text.endsWith('\n')
  }
}
