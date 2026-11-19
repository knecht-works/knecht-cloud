import type { Step } from '#shared/utils/workflow'
import type { RegisteredAction } from '#server/workflows/actions/types'
import { ddevStartAction } from '#server/workflows/actions/ddev-start'
import { bashAction } from '#server/workflows/actions/bash'
import { aiAction } from '#server/workflows/actions/ai'
import { jsAction } from '#server/workflows/actions/js'
import { httpAction } from '#server/workflows/actions/http'
import { linkCheckAction } from '#server/workflows/actions/link-check'
import { createBranchAction } from '#server/workflows/actions/create-branch'
import { createCommitAction } from '#server/workflows/actions/create-commit'
import { createPrAction } from '#server/workflows/actions/create-pr'

export type { ActionDef, ActionRuntime, RegisteredAction } from '#server/workflows/actions/types'
export { ActionError } from '#server/workflows/actions/types'

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
  if (!action) throw new Error(`Unknown step type: ${type}`)
  return action
}
