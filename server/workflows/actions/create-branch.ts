import { z } from 'zod'
import { createBranch } from '../../daemon/git'
import { defineAction } from './types'
import { requireSession, updateSession } from '../../stores/sessions'
import { updateRun } from '../../stores/runs'

export const createBranchAction = defineAction({
  type: 'create-branch',
  params: {
    name: z.string().min(1),
  },
  legacyKey: 'branch',
  async run(step, rt) {
    rt.log(`\n▶ create-branch: ${step.name}\n`)
    await rt.sandbox.ensureUp()
    // One session, one work branch: a later workflow (a review on its PR) must not re-point the shared checkout.
    const current = requireSession(rt.sessionId).branch
    const kept = !!current && current !== rt.project.defaultBranch
    const name = kept ? current : step.name
    if (!kept) await createBranch(rt.sandbox, name)
    else if (name !== step.name) rt.log(`The session already works on ${name}: keeping it\n`)
    updateRun(rt.runId, { branch: name })
    updateSession(rt.sessionId, { branch: name })
    return { name }
  },
})
