import { describe, expect, it } from 'vitest'
import { getSessionRow, makeProject, makeSession } from '../helpers/db'

const { asOperation, envOperation, inMailbox, relabelOperation } = await import('#server/daemon/session-env')

function session() {
  return makeSession(makeProject()).id
}

function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

describe('session mailbox', () => {
  it('runs the operations of one session one after another', async () => {
    const id = session()
    const events: string[] = []
    const first = gate()
    const a = inMailbox(id, 'booting', async () => {
      events.push('boot start')
      await first.opened
      events.push('boot end')
    })
    const b = inMailbox(id, 'stopping', async () => {
      events.push('stop')
    })
    await Promise.resolve()
    expect(envOperation(id)).toBe('booting')
    first.open()
    await Promise.all([a, b])
    expect(events).toEqual(['boot start', 'boot end', 'stop'])
    expect(envOperation(id)).toBeNull()
  })

  it('runs different sessions side by side', async () => {
    const busy = session()
    const other = session()
    const held = gate()
    const a = inMailbox(busy, 'booting', () => held.opened)
    await inMailbox(other, 'stopping', async () => {})
    expect(envOperation(busy)).toBe('booting')
    held.open()
    await a
  })

  it('shows a step of a running operation under its own label without queueing it', async () => {
    const id = session()
    const seen: (string | null)[] = []
    await inMailbox(id, null, async () => {
      await asOperation(id, 'rebooting', async () => {
        seen.push(envOperation(id))
      })
      seen.push(envOperation(id))
    })
    expect(seen).toEqual(['rebooting', null])
  })

  it('holds back a call from inside an operation until that operation finished', async () => {
    const id = session()
    const events: string[] = []
    let inner: Promise<void> | undefined
    await inMailbox(id, 'booting', async () => {
      inner = inMailbox(id, 'stopping', async () => {
        events.push('stop')
      })
      await Promise.resolve()
      events.push('boot end')
    })
    await inner
    expect(events).toEqual(['boot end', 'stop'])
  })

  it('runs the next operation after one that failed', async () => {
    const id = session()
    const failed = inMailbox(id, 'booting', async () => {
      throw new Error('boom')
    })
    const next = inMailbox(id, 'stopping', async () => 'stopped')
    await expect(failed).rejects.toThrow('boom')
    await expect(next).resolves.toBe('stopped')
  })

  it('relabels only the operation it expects', async () => {
    const id = session()
    const held = gate()
    const a = inMailbox(id, 'booting', () => held.opened)
    await Promise.resolve()
    relabelOperation(id, 'archiving', 'stopping')
    expect(envOperation(id)).toBe('booting')
    relabelOperation(id, 'booting', 'stopping')
    expect(envOperation(id)).toBe('stopping')
    held.open()
    await a
  })

  it('records the running operation on the session until it finished', async () => {
    const session = makeSession(makeProject())
    const held = gate()
    const a = inMailbox(session.id, 'archiving', () => held.opened)
    await Promise.resolve()
    expect(getSessionRow(session.id).envOperation).toBe('archiving')
    held.open()
    await a
    expect(getSessionRow(session.id).envOperation).toBeNull()
  })
})
