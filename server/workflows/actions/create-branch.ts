import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'
import { createBranch } from '../../daemon/git'
import { defineAction } from './types'

export const createBranchAction = defineAction({
  type: 'create-branch',
  params: {
    name: z.string().min(1),
  },
  legacyKey: 'branch',
  async run(step, rt) {
    rt.log(`\n▶ create-branch: ${step.name}\n`)
    await createBranch(rt.checkoutDir, step.name)
    db.update(schema.runs).set({ branch: step.name }).where(eq(schema.runs.id, rt.runId)).run()
    db.update(schema.sessions).set({ branch: step.name }).where(eq(schema.sessions.id, rt.sessionId)).run()
    return { name: step.name }
  },
})
