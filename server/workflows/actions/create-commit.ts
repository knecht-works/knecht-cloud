import { z } from 'zod'
import { commitAll } from '../../daemon/git'
import { defineAction } from './types'

export const createCommitAction = defineAction({
  type: 'create-commit',
  params: {
    message: z.string().min(1),
  },
  legacyKey: 'commit',
  async run(step, rt) {
    rt.log(`\n▶ create-commit: ${step.message}\n`)
    const sha = await commitAll(rt.checkoutDir, step.message)
    if (sha) {
      rt.log(`Committed ${sha.slice(0, 8)}\n`)
      return { sha, created: true }
    }
    rt.log(`Nothing to commit, skipping\n`)
    return { created: false }
  },
})
