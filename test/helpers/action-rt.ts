import type { ActionRuntime } from '../../server/workflows/actions'

export function bareRuntime(): ActionRuntime {
  return {
    log: () => {},
    signal: new AbortController().signal,
  } as ActionRuntime
}
