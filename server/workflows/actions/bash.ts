import { z } from 'zod'
import type { Step } from '#shared/utils/workflow'
import { defineAction, ActionError } from '#server/workflows/actions/types'
import { renderShell } from '#server/workflows/shell-template'

const STDOUT_TAIL_CHARS = 8_192

export const bashAction = defineAction({
  type: 'bash',
  params: {
    command: z.string().min(1),
    startPreview: z.boolean().optional(),
  },
  yaml: z.object({
    bash: z.object({
      'command': z.string().min(1),
      'continue-on-error': z.boolean().optional(),
      'start-preview': z.boolean().optional(),
    }),
  }).transform(({ bash }): Step => ({
    type: 'bash',
    command: bash.command,
    continueOnError: bash['continue-on-error'] ?? false,
    ...(bash['start-preview'] ? { startPreview: true } : {}),
  })),
  templateParams: ['command'],
  async run(step, rt) {
    const { command, env } = renderShell(step.command, rt.ctx)
    rt.log(`\n▶ bash: ${command}\n`)
    if (step.startPreview) await rt.sandbox.ensureUp()
    const { stream, release } = step.startPreview ? { stream: rt.sandbox.stream, release: async () => {} } : await rt.sandbox.withoutPreview()
    const { code, tail } = await stream(['bash', '-lc', command], { env }).finally(release)
    const outputs = { exitCode: code, stdout: tail.slice(-STDOUT_TAIL_CHARS).trim() }
    if (code !== 0) throw new ActionError(`Command exited with code ${code}`, outputs)
    return outputs
  },
})
