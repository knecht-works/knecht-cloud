import type { Step } from '../../../shared/utils/workflow'
import type { RegisteredAction } from './types'
import { ddevStartAction } from './ddev-start'
import { bashAction } from './bash'
import { createBranchAction } from './create-branch'
import { createCommitAction } from './create-commit'
import { createPrAction } from './create-pr'

export type { ActionDef, ActionRuntime, RegisteredAction } from './types'

// The action registry. Adding a step type is: extend the Step union
// (shared/utils/workflow.ts, incl. STEP_OUTPUTS), write an action module here,
// list it below, and describe it for the editor (app/utils/workflow-steps.ts).
// Both workflow schemas (server/workflows/schema.ts) assemble from this list.
export const ACTIONS: RegisteredAction[] = [
  ddevStartAction,
  bashAction,
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
