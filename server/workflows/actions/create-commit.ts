import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { commitAll } from '../../daemon/git'
import { defineAction } from './types'

export const createCommitAction = defineAction({
  type: 'create-commit',
  params: {
    message: z.string().min(1),
  },
  yaml: z.object({ 'create-commit': z.object({ message: z.string().min(1) }) })
    .transform(({ 'create-commit': p }): Step => ({ type: 'create-commit', message: p.message })),
  legacyKey: 'commit',
  async run(step, rt) {
    rt.log(`\n▶ create-commit: ${step.message}\n`)
    const sha = await commitAll(rt.checkoutDir, step.message)
    if (sha) {
      rt.log(`Committed ${sha.slice(0, 8)}\n`)
      return { sha, created: true }
    }
    rt.log(`Nothing to commit — skipping\n`)
    return { created: false }
  },
})
