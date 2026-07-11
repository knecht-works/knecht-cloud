import type { Step } from '../../../shared/utils/workflow'
import type { RegisteredAction } from './types'
import { ddevStartAction } from './ddev-start'
import { bashAction } from './bash'
import { aiAction } from './ai'
import { jsAction } from './js'
import { httpAction } from './http'
import { linkCheckAction } from './link-check'
import { createBranchAction } from './create-branch'
import { createCommitAction } from './create-commit'
import { createPrAction } from './create-pr'

export type { ActionDef, ActionRuntime, RegisteredAction } from './types'
export { ActionError } from './types'

// The action registry. Adding a step type is: extend the Step union
// (shared/utils/workflow.ts), write an action module here and list it below,
// and describe it for the client in app/utils/steps/<type>.ts. Both workflow
// schemas (server/workflows/schema.ts) assemble from this list.
export const ACTIONS: RegisteredAction[] = [
  ddevStartAction,
  bashAction,
  aiAction,
  jsAction,
  httpAction,
  linkCheckAction,
  createBranchAction,
  createCommitAction,
  createPrAction,
]

const BY_TYPE = new Map(ACTIONS.map(a => [a.type, a]))

export function actionFor(type: Step['type']): RegisteredAction {
  const action = BY_TYPE.get(type)
  // Unreachable for a schema-validated workflow; guards stale DB rows.
  if (!action) throw new Error(`Unknown step type: ${type}`)
  return action
}
