import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { defineAction, ActionError } from './types'

// How much of the command's output tail becomes the step's `stdout` output
// (referencable by later steps); the full stream is already in the run log.
const STDOUT_TAIL_CHARS = 8_192

export const bashAction = defineAction({
  type: 'bash',
  params: {
    command: z.string().min(1),
  },
  yaml: z.object({
    bash: z.object({
      'command': z.string().min(1),
      // Maps to the step-level error policy (StepMeta.continueOnError).
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
    // sandbox, in the mounted checkout, never on the Knecht host.
    await rt.sandbox.ensureUp()
    const { code, tail } = await rt.sandbox.stream(['bash', '-lc', step.command])
    const outputs = { exitCode: code, stdout: tail.slice(-STDOUT_TAIL_CHARS).trim() }
    // A non-zero exit throws; the runner's step policy decides whether the
    // run continues (continueOnError, the outputs stay referencable) or
    // retries (retry).
    if (code !== 0) throw new ActionError(`Command exited with code ${code}`, outputs)
    return outputs
  },
})
