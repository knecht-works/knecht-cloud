import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { defineAction, ActionError } from './types'

const STDOUT_TAIL_CHARS = 8_192

export const bashAction = defineAction({
  type: 'bash',
  params: {
    command: z.string().min(1),
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
    await rt.sandbox.ensureUp()
    const { code, tail } = await rt.sandbox.stream(['bash', '-lc', step.command])
    const outputs = { exitCode: code, stdout: tail.slice(-STDOUT_TAIL_CHARS).trim() }
    if (code !== 0) throw new ActionError(`Command exited with code ${code}`, outputs)
    return outputs
  },
})
