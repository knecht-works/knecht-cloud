import { Readable, Writable } from 'node:stream'
import { client, methods, ndJsonStream, PROTOCOL_VERSION, type ClientConnection, type PermissionOption, type SessionConfigOption, type SessionUpdate, type StopReason, type ToolCallStatus, type ToolCallUpdate, type ToolKind } from '@agentclientprotocol/sdk'
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

export interface TranscriptItem {
  key: string
  type: 'message' | 'tool' | 'usage' | 'notice' | 'divider'
  text: string
  kind?: ToolKind | null
  status?: ToolCallStatus | null
  input?: unknown
  output?: string | null
  diff?: { path: string, oldText: string | null, newText: string } | null
  locations?: string[] | null
  cost?: number | null
  tokens?: { used: number, size: number } | null
}

// Receives every item again whenever it changes (a message grows, a tool call finishes).
export interface TranscriptSink {
  item: (item: TranscriptItem) => void
  end: () => void
}

interface OpenAgentOptions {
  process: SandboxProcess
  cwd: string
  sink: TranscriptSink
  signal: AbortSignal
  /** Resume this agent session; falls back to a new one when the agent no longer knows it. */
  sessionId?: string | null
  /** Provider-qualified model the turn must run on; a resumed session otherwise keeps its last one. */
  model?: string | null
}

const CANCEL_GRACE_MS = 10_000
const STDERR_TAIL = 4 * 1024
const OUTPUT_CAP = 4 * 1024

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
  const { process: proc, sink } = opts
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
    let configOptions: SessionConfigOption[] | null | undefined
    if (opts.sessionId) {
      try {
        const resumed = await untilExit(agent.request(methods.agent.session.load, { sessionId: opts.sessionId, cwd: opts.cwd, mcpServers: [] }))
        sessionId = opts.sessionId
        loaded = true
        configOptions = resumed.configOptions
      }
      catch (e) {
        sink.item(notice(`Could not resume the agent session, starting a new one: ${(e as Error).message}`))
      }
    }
    if (!loaded) {
      const created = await untilExit(agent.request(methods.agent.session.new, { cwd: opts.cwd, mcpServers: [] }))
      sessionId = created.sessionId
      configOptions = created.configOptions
    }
    const modelOption = configOptions?.find(o => o.id === 'model')
    if (opts.model && modelOption && modelOption.type === 'select' && modelOption.currentValue !== opts.model) {
      try {
        await untilExit(agent.request(methods.agent.session.setConfigOption, { sessionId: sessionId!, configId: modelOption.id, value: opts.model }))
      }
      catch (e) {
        sink.item(notice(`Could not switch this turn to ${opts.model}, it runs on ${modelOption.currentValue}: ${(e as Error).message}`))
      }
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
      turn = new Turn(sessionId, sink)
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
        sink.end()
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

let noticeCounter = 0

export function notice(text: string): TranscriptItem {
  return { key: `notice:${++noticeCounter}`, type: 'notice', text }
}

// The log form of a transcript: message text streamed, one line per finished tool call.
export function logSink(log: (text: string) => void): TranscriptSink {
  const written = new Map<string, number>()
  let atLineStart = true
  const write = (text: string) => {
    if (!text) return
    log(text)
    atLineStart = text.endsWith('\n')
  }
  const line = (text: string) => write(`${atLineStart ? '' : '\n'}${text}\n`)
  return {
    item(item) {
      switch (item.type) {
        case 'message': {
          const done = written.get(item.key) ?? 0
          write(item.text.slice(done))
          written.set(item.key, item.text.length)
          return
        }
        // Logged once finished: a shell call's title is only the command after its input arrived.
        case 'tool': {
          if (written.has(item.key) || (item.status !== 'completed' && item.status !== 'failed')) return
          written.set(item.key, 1)
          line(`${item.status === 'failed' ? 'failed ' : ''}${KIND_LABEL[item.kind ?? 'other']}: ${item.text}`)
          return
        }
        case 'notice':
          line(item.text)
          return
        default:
      }
    },
    end() {
      if (!atLineStart) write('\n')
      written.clear()
    },
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

// opencode reports a shell call's stdout as rawOutput.output, wrapped in metadata nobody wants to read.
function toolOutput(tool: ToolCallUpdate): string | null {
  const raw = tool.rawOutput as { output?: unknown } | string | null | undefined
  const content = (tool.content ?? [])
    .map(c => c.type === 'content' && c.content.type === 'text' ? c.content.text : '')
    .filter(Boolean)
    .join('\n')
  const text = content
    || (typeof raw === 'string' ? raw : typeof raw?.output === 'string' ? raw.output : raw != null ? JSON.stringify(raw, null, 2) : '')
  if (!text) return null
  return text.length > OUTPUT_CAP ? `${text.slice(0, OUTPUT_CAP)}\n… [${text.length - OUTPUT_CAP} more characters not kept]` : text
}

function toolDiff(tool: ToolCallUpdate): TranscriptItem['diff'] {
  const diff = tool.content?.find(c => c.type === 'diff')
  return diff && diff.type === 'diff' ? { path: diff.path, oldText: diff.oldText ?? null, newText: diff.newText } : null
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
  private messages: { key: string, text: string }[] = []
  private messageId: string | null | undefined
  private tools = new Map<string, ToolCallUpdate>()
  private messageCount = 0

  constructor(readonly sessionId: string, private readonly sink: TranscriptSink) {}

  apply(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        if (update.content.type !== 'text') return
        if (update.messageId !== this.messageId || !this.messages.length) {
          this.messageId = update.messageId
          this.messages.push({ key: `message:${++this.messageCount}`, text: '' })
        }
        const message = this.messages.at(-1)!
        message.text += update.content.text
        this.sink.item({ key: message.key, type: 'message', text: message.text })
        return
      }
      case 'tool_call':
      case 'tool_call_update': {
        const known = this.tools.get(update.toolCallId) ?? { toolCallId: update.toolCallId }
        const merged: ToolCallUpdate = { ...known, ...withoutNulls(update), toolCallId: update.toolCallId }
        this.tools.set(update.toolCallId, merged)
        this.sink.item({
          key: `tool:${update.toolCallId}`,
          type: 'tool',
          text: toolLabel(merged),
          kind: merged.kind ?? 'other',
          status: merged.status ?? 'pending',
          input: merged.rawInput,
          output: toolOutput(merged),
          diff: toolDiff(merged),
          locations: merged.locations?.map(l => l.path) ?? null,
        })
        return
      }
      case 'usage_update': {
        this.sink.item({
          key: 'usage',
          type: 'usage',
          text: '',
          tokens: { used: update.used, size: update.size },
          cost: update.cost?.amount ?? null,
        })
        return
      }
      default:
    }
  }

  reply(): string {
    const last = [...this.messages].reverse().find(m => m.text.trim())
    return (last?.text ?? '').trim()
  }
}
