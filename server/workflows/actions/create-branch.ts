import { z } from 'zod'
import { createBranch } from '../../daemon/git'
import { defineAction } from './types'
import { updateSession } from '../../stores/sessions'
import { updateRun } from '../../stores/runs'

export const createBranchAction = defineAction({
  type: 'create-branch',
  params: {
    name: z.string().min(1),
  },
  legacyKey: 'branch',
  async run(step, rt) {
    rt.log(`\n▶ create-branch: ${step.name}\n`)
    await createBranch(rt.checkoutDir, step.name)
    updateRun(rt.runId, { branch: step.name })
    updateSession(rt.sessionId, { branch: step.name })
    return { name: step.name }
  },
})
