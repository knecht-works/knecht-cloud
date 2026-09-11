import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { openRunTerminal, type RunTerminal } from '../../../daemon/terminal'
import { isMember, memberCount } from '../../../utils/members'
import { requireSession } from '../../../utils/entities'

// The /api auth middleware does not cover the upgrade request: session and membership are checked here.
// Client frames are JSON ({t:'i',d} input, {t:'r',cols,rows} resize), server frames are raw TTY bytes.

const terminals = new Map<string, RunTerminal>()
const closedEarly = new Set<string>()

const lastBump = new Map<number, number>()
function bumpPreviewSeen(sessionId: number): void {
  const now = Date.now()
  if (now - (lastBump.get(sessionId) ?? 0) < 30_000) return
  lastBump.set(sessionId, now)
  db.update(schema.sessions).set({ previewLastSeen: new Date() }).where(eq(schema.sessions.id, sessionId)).run()
}

function parseTerminalUrl(url: string): { runId: number, service: string, cols: number, rows: number } | null {
  const parsed = new URL(url, 'http://localhost')
  const match = /^\/api\/runs\/(\d+)\/terminal$/.exec(parsed.pathname)
  if (!match) return null
  const service = parsed.searchParams.get('service') ?? 'web'
  if (!/^[a-z0-9-]+$/i.test(service)) return null
  return {
    runId: Number(match[1]),
    service,
    cols: Math.max(2, Number(parsed.searchParams.get('cols')) || 80),
    rows: Math.max(2, Number(parsed.searchParams.get('rows')) || 24),
  }
}

export default defineWebSocketHandler({
  async upgrade(request) {
    const session = await getUserSession(request)
    if (!session?.user) {
      throw createError({ statusCode: 401, statusMessage: 'Login required' })
    }
    if (memberCount() > 0 && !isMember(session.user.login)) {
      throw createError({ statusCode: 403, statusMessage: 'Membership revoked' })
    }
    const target = parseTerminalUrl(request.url)
    if (!target) {
      throw createError({ statusCode: 400, statusMessage: 'Bad terminal target' })
    }
    const env = requireSession(requireRun(target.runId).sessionId)
    if (env.envState !== 'up') {
      throw createError({ statusCode: 409, statusMessage: 'Environment is not running' })
    }
  },

  async open(peer) {
    const target = parseTerminalUrl(peer.request?.url ?? '')
    if (!target) return peer.close(1008, 'Bad terminal target')
    const anchor = getRun(target.runId)
    if (!anchor) return peer.close(1008, 'Bad terminal target')
    try {
      const terminal = await openRunTerminal(anchor.sessionId, target.service, target)
      // close() ran before this terminal existed: discard it, or the
      // container-side shell leaks forever.
      if (closedEarly.delete(peer.id)) {
        terminal.close()
        return
      }
      terminals.set(peer.id, terminal)
      terminal.stream.on('data', (chunk: Buffer) => peer.send(chunk))
      terminal.stream.on('close', () => peer.close(1000, 'Session ended'))
      terminal.stream.on('error', () => peer.close(1011, 'Session error'))
      bumpPreviewSeen(anchor.sessionId)
    }
    catch {
      closedEarly.delete(peer.id)
      peer.close(1011, 'Could not open a shell in the container')
    }
  },

  message(peer, message) {
    const terminal = terminals.get(peer.id)
    const target = parseTerminalUrl(peer.request?.url ?? '')
    if (!terminal || !target) return
    try {
      const frame = JSON.parse(message.text()) as { t?: string, d?: string, cols?: number, rows?: number }
      if (frame.t === 'i' && typeof frame.d === 'string') {
        terminal.stream.write(frame.d)
        const anchor = getRun(target.runId)
        if (anchor) bumpPreviewSeen(anchor.sessionId)
      }
      else if (frame.t === 'r' && frame.cols && frame.rows) {
        terminal.resize(frame.cols, frame.rows)
      }
    }
    catch {
      // Not a frame of ours.
    }
  },

  close(peer) {
    const terminal = terminals.get(peer.id)
    if (terminal) {
      terminal.close()
      terminals.delete(peer.id)
    }
    else {
      closedEarly.add(peer.id)
    }
  },
})
