import { cancellable, type EnvTransition } from '#shared/utils/run'
import { getSessionRow, updateSession } from '#server/stores/sessions'

interface Mailbox {
  tail: Promise<unknown>
  queued: number
  operation: EnvTransition | null
  running: AbortController | null
  coalesced: Map<EnvTransition, Promise<unknown>>
}

const mailboxes = new Map<number, Mailbox>()

export class SessionGone extends Error {
  constructor(sessionId: number) {
    super(`Session ${sessionId} was deleted`)
  }
}

export class OperationCancelled extends Error {
  constructor(sessionId: number) {
    super(`The environment operation of session ${sessionId} was cancelled`)
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
  const box = mailboxes.get(sessionId) ?? { tail: Promise.resolve(), queued: 0, operation: null, running: null, coalesced: new Map() }
  mailboxes.set(sessionId, box)
  const same = coalesce && operation ? box.coalesced.get(operation) : undefined
  if (same) return same as Promise<T>

  box.queued++
  const run = box.tail.then(() => {
    // Queued before the delete, run after it.
    if (!getSessionRow(sessionId)) throw new SessionGone(sessionId)
    const running = new AbortController()
    box.running = running
    return labelled(sessionId, box, operation, fn)
      // Whichever step noticed the abort, the caller sees why.
      .catch((e) => { throw running.signal.aborted ? running.signal.reason : e })
      .finally(() => {
        if (box.running === running) box.running = null
      })
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

export function operationSignal(sessionId: number): AbortSignal | undefined {
  return mailboxes.get(sessionId)?.running?.signal
}

// The operation rolls back to where it started and shows as stopping meanwhile.
export function cancelOperation(sessionId: number): boolean {
  const box = mailboxes.get(sessionId)
  if (!box?.running || !cancellable(box.operation) || box.running.signal.aborted) return false
  box.running.abort(new OperationCancelled(sessionId))
  relabelOperation(sessionId, box.operation!, 'stopping')
  return true
}

// Whatever runs, the teardown that follows removes what it leaves behind.
export function abortOperation(sessionId: number): void {
  mailboxes.get(sessionId)?.running?.abort(new SessionGone(sessionId))
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
