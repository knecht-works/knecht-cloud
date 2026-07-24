import { eq } from 'drizzle-orm'
import { db, schema } from '../../../db'
import { openRunTerminal, type RunTerminal } from '../../../daemon/terminal'
import { isMember, memberCount } from '../../../utils/members'

// WS /api/runs/:id/terminal?service=web&cols=120&rows=32 → the run page's web
// terminal: an interactive shell in one of the run's service containers
// (daemon/terminal.ts), frames over the dashboard's existing 443 connection
// (Caddy proxies upgrades transparently). Client frames are JSON:
// `{t:'i',d}` writes input, `{t:'r',cols,rows}` resizes; server frames are
// raw TTY bytes. No new privilege: any member can already exec arbitrary
// commands via follow-ups; this is the same container shell the agent uses.
//
// The /api auth middleware is NOT relied on for the upgrade request: the
// session + membership check happens explicitly here (nuxt-auth-utils
// supports ws upgrade requests), mirroring preview-proxy.ts.

const terminals = new Map<string, RunTerminal>()
// Peers whose socket closed while open() was still awaiting the exec: open()
// checks this once it resolves and discards the late terminal.
const closedEarly = new Set<string>()

// Typing in a terminal counts as using the env: bump the idle clock, at most
// once per 30s per run (unlike an external SSH session, this traffic flows
// through the app, so a long session properly keeps the env alive).
const lastBump = new Map<number, number>()
function bumpPreviewSeen(runId: number): void {
  const now = Date.now()
  if (now - (lastBump.get(runId) ?? 0) < 30_000) return
  lastBump.set(runId, now)
  db.update(schema.runs).set({ previewLastSeen: new Date() }).where(eq(schema.runs.id, runId)).run()
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
    // Same per-request re-check as the /api gate: a removed member's
    // still-valid session must not open shells.
    if (memberCount() > 0 && !isMember(session.user.login)) {
      throw createError({ statusCode: 403, statusMessage: 'Membership revoked' })
    }
    const target = parseTerminalUrl(request.url)
    if (!target) {
      throw createError({ statusCode: 400, statusMessage: 'Bad terminal target' })
    }
    const run = requireRun(target.runId)
    if (run.envState !== 'up') {
      throw createError({ statusCode: 409, statusMessage: 'Environment is not running' })
    }
  },

  async open(peer) {
    const target = parseTerminalUrl(peer.request?.url ?? '')
    if (!target) return peer.close(1008, 'Bad terminal target')
    try {
      const terminal = await openRunTerminal(target.runId, target.service, target)
      // The socket may have closed while the exec was being set up (close()
      // ran before this terminal existed). Discard it, or it leaks the
      // container-side shell and its stream forever.
      if (closedEarly.delete(peer.id)) {
        terminal.close()
        return
      }
      terminals.set(peer.id, terminal)
      terminal.stream.on('data', (chunk: Buffer) => peer.send(chunk))
      terminal.stream.on('close', () => peer.close(1000, 'Session ended'))
      terminal.stream.on('error', () => peer.close(1011, 'Session error'))
      bumpPreviewSeen(target.runId)
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
        bumpPreviewSeen(target.runId)
      }
      else if (frame.t === 'r' && frame.cols && frame.rows) {
        terminal.resize(frame.cols, frame.rows)
      }
    }
    catch {
      // Not a frame of ours: drop it.
    }
  },

  close(peer) {
    const terminal = terminals.get(peer.id)
    if (terminal) {
      terminal.close()
      terminals.delete(peer.id)
    }
    else {
      // open() is still awaiting the exec: mark it so it discards the terminal
      // once it resolves instead of storing an orphan nothing will close.
      closedEarly.add(peer.id)
    }
  },
})
