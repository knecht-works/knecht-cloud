import type { ActionRuntime } from '../../server/workflows/actions'

// A minimal runtime for actions that never touch the sandbox or the checkout
// (http, link-check): just a silent log and a live signal. Anything else is
// deliberately absent so a test fails loudly if the action starts needing it.
export function bareRuntime(): ActionRuntime {
  return {
    log: () => {},
    signal: new AbortController().signal,
  } as ActionRuntime
}
