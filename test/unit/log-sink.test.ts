import { describe, expect, it } from 'vitest'
import { logSink } from '../../server/daemon/agent'

describe('logSink', () => {
  it('streams a message once and forgets its offset when the turn ends', () => {
    let out = ''
    const sink = logSink((t) => {
      out += t
    })
    sink.item({ key: 'message:1', type: 'message', text: 'Hello' })
    sink.item({ key: 'message:1', type: 'message', text: 'Hello world' })
    sink.end()
    sink.item({ key: 'message:1', type: 'message', text: 'Hi' })
    sink.end()
    expect(out).toBe('Hello world\nHi\n')
  })
})
