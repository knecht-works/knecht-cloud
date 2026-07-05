import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { db, schema } from '../../db'
import { createBranch } from '../../daemon/git'
import { defineAction } from './types'

export const createBranchAction = defineAction({
  type: 'create-branch',
  params: {
    name: z.string().min(1),
  },
  yaml: z.object({ 'create-branch': z.object({ name: z.string().min(1) }) })
    .transform(({ 'create-branch': p }): Step => ({ type: 'create-branch', name: p.name })),
  async run(step, rt) {
    rt.log(`\n▶ create-branch: ${step.name}\n`)
    await createBranch(rt.checkoutDir, step.name)
    db.update(schema.runs).set({ branch: step.name }).where(eq(schema.runs.id, rt.runId)).run()
    return { branch: { name: step.name } }
  },
})
