// A minimal ACP agent for tests: spoken to over stdio exactly like opencode acp.
// Prompt text drives its behaviour so tests can script a turn from the outside.
import { writeFileSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const KNOWN_SESSION = 'ses_stub_known'
let counter = 0
let cancelHanging = () => {}

agent({ name: 'stub' })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
  }))
  .onRequest(methods.agent.session.new, () => ({ sessionId: `ses_stub_${++counter}` }))
  .onRequest(methods.agent.session.load, ({ params }) => {
    if (params.sessionId !== KNOWN_SESSION) throw new Error(`unknown session ${params.sessionId}`)
    return {}
  })
  .onNotification(methods.agent.session.cancel, () => cancelHanging())
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    const { sessionId } = params
    const text = params.prompt.map(p => p.type === 'text' ? p.text : '').join('')
    const update = u => client.notify(methods.client.session.update, { sessionId, update: u })

    if (text.includes('ASK_PERMISSION')) {
      const answer = await client.request(methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: 'perm' },
        options: [
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        ],
      })
      await update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `permission: ${answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled'}` } })
      return { stopReason: 'end_turn' }
    }

    await update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read AGENTS.md', kind: 'read', status: 'in_progress' })
    await update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: 'secret file contents' })

    if (text.includes('HANG')) {
      await new Promise((resolve) => {
        cancelHanging = resolve
      })
      return { stopReason: 'cancelled' }
    }
    if (text.includes('EXIT')) process.exit(3)

    // Knecht's output contract names the file; the prompt supplies what to put in it.
    const out = /WRITE_OUTPUT (.+)$/m.exec(text)
    const file = /to the file `([^`]+)`/.exec(text)
    if (out && file) writeFileSync(file[1], out[1])

    await update({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'Thinking about it.' } })
    await update({ sessionUpdate: 'tool_call', toolCallId: 't2', title: 'npm test', kind: 'execute', status: 'completed' })
    await update({ sessionUpdate: 'agent_message_chunk', messageId: 'm2', content: { type: 'text', text: 'Hello from ' } })
    await update({ sessionUpdate: 'agent_message_chunk', messageId: 'm2', content: { type: 'text', text: `stub (${text.includes('LOADED') ? 'loaded' : 'fresh'})` } })
    return { stopReason: 'end_turn' }
  })
  .connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
