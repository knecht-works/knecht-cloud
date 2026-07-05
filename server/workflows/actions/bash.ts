import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { defineAction } from './types'

export const bashAction = defineAction({
  type: 'bash',
  params: {
    command: z.string().min(1),
    continueOnError: z.boolean().default(false),
  },
  yaml: z.object({
    bash: z.object({
      'command': z.string().min(1),
      'continue-on-error': z.boolean().optional(),
    }),
  }).transform(({ bash }): Step => ({
    type: 'bash',
    command: bash.command,
    continueOnError: bash['continue-on-error'] ?? false,
  })),
  async run(step, rt) {
    rt.log(`\n▶ bash: ${step.command}\n`)
    // Project-facing commands (ddev, the agent, builds) run INSIDE the run's
    // sandbox, in the mounted checkout — never on the Knecht host.
    await rt.sandbox.ensureUp()
    const code = await rt.sandbox.stream(['bash', '-lc', step.command])
    if (code !== 0 && !step.continueOnError) {
      throw new Error(`Command exited with code ${code}`)
    }
  },
})
