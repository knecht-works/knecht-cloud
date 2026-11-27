import type { EnvTransition } from '#shared/utils/run'
import { getSessionRow, updateSession } from '#server/stores/sessions'

interface Mailbox {
  tail: Promise<unknown>
  queued: number
  operation: EnvTransition | null
  coalesced: Map<EnvTransition, Promise<unknown>>
}

const mailboxes = new Map<number, Mailbox>()

export class SessionGone extends Error {
  constructor(sessionId: number) {
    super(`Session ${sessionId} was deleted`)
  }
}

export function envOperation(sessionId: number): EnvTransition | null {
  return mailboxes.get(sessionId)?.operation ?? null
}

export function relabelOperation(sessionId: number, from: EnvTransition, to: EnvTransition): void {
  const box = mailboxes.get(sessionId)
  if (box?.operation !== from) return
  box.operation = to
  updateSession(sessionId, { envOperation: to })
}

// `operation` null: too frequent to show (every step starts its sandbox), but still one at a time.
// `coalesce`: a call while the same operation is queued or running joins it instead of repeating it.
export function inMailbox<T>(sessionId: number, operation: EnvTransition | null, fn: () => Promise<T>, { coalesce = false } = {}): Promise<T> {
  if (!getSessionRow(sessionId)) return Promise.reject(new SessionGone(sessionId))
  const box = mailboxes.get(sessionId) ?? { tail: Promise.resolve(), queued: 0, operation: null, coalesced: new Map() }
  mailboxes.set(sessionId, box)
  const same = coalesce && operation ? box.coalesced.get(operation) : undefined
  if (same) return same as Promise<T>

  box.queued++
  const run = box.tail.then(() => {
    // Queued before the delete, run after it.
    if (!getSessionRow(sessionId)) throw new SessionGone(sessionId)
    return labelled(sessionId, box, operation, fn)
  })
  box.tail = run.catch(() => {})
  if (coalesce && operation) box.coalesced.set(operation, run)
  const settle = () => {
    box.queued--
    if (operation && box.coalesced.get(operation) === run) box.coalesced.delete(operation)
    if (!box.queued && mailboxes.get(sessionId) === box) mailboxes.delete(sessionId)
  }
  run.then(settle, settle)
  return run
}

export function mailboxDrained(sessionId: number): Promise<unknown> {
  return mailboxes.get(sessionId)?.tail ?? Promise.resolve()
}

// For a step of an operation that already holds the mailbox: queueing it would wait for itself.
export function asOperation<T>(sessionId: number, operation: EnvTransition, fn: () => Promise<T>): Promise<T> {
  const box = mailboxes.get(sessionId)
  return box ? labelled(sessionId, box, operation, fn) : fn()
}

async function labelled<T>(sessionId: number, box: Mailbox, operation: EnvTransition | null, fn: () => Promise<T>): Promise<T> {
  if (!operation) return fn()
  const outer = box.operation
  box.operation = operation
  updateSession(sessionId, { envOperation: operation })
  try {
    return await fn()
  }
  finally {
    box.operation = outer
    updateSession(sessionId, { envOperation: outer })
  }
}
