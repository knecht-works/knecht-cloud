import { openRunTerminal, type RunTerminal } from '#server/daemon/terminal'
import { sessionMember } from '#server/utils/member-session'
import { getSessionRow, touchSessionPreview } from '#server/stores/sessions'
import { getRun } from '#server/stores/runs'
import { defineWebSocketHandler } from 'h3'
import { isPreviewHost } from '#shared/utils/preview-host'
import { isForeignOrigin } from '#server/utils/origin'
import { getUserSession } from '#imports'

// The /api auth middleware does not cover the upgrade request: session and membership are checked here.
// Rejections are Responses: crossws leaves the socket hanging on any other error.
// Client frames are JSON ({t:'i',d} input, {t:'r',cols,rows} resize), server frames are raw TTY bytes.

const terminals = new Map<string, RunTerminal>()
const closedEarly = new Set<string>()

const lastBump = new Map<number, number>()
function bumpPreviewSeen(sessionId: number): void {
  const now = Date.now()
  if (now - (lastBump.get(sessionId) ?? 0) < 30_000) return
  lastBump.set(sessionId, now)
  touchSessionPreview(sessionId)
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
    // Upgrades skip the HTTP middleware, so a preview host would otherwise reach this route too.
    const host = request.headers.get('host') ?? ''
    if (isPreviewHost(host) || isForeignOrigin(request.headers.get('origin'), host)) {
      throw new Response('Cross-origin request refused', { status: 403 })
    }
    const session = await getUserSession(request)
    if (!session?.user) {
      throw new Response('Login required', { status: 401 })
    }
    if (!sessionMember(session)) {
      throw new Response('Membership revoked', { status: 403 })
    }
    const target = parseTerminalUrl(request.url)
    if (!target) {
      throw new Response('Bad terminal target', { status: 400 })
    }
    const run = getRun(target.runId)
    const env = run && getSessionRow(run.sessionId)
    if (!env) {
      throw new Response('Run not found', { status: 404 })
    }
    if (env.envState !== 'up') {
      throw new Response('Environment is not running', { status: 409 })
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
