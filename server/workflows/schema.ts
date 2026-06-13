import { parse } from 'yaml'
import { z } from 'zod'

// The workflow definition format (workflows.md §10, mvp.md §3.2): a linear
// sequence of blocks. The visual builder will read/write this same YAML later;
// for now the engine just parses + Zod-validates it.
//
// A step is written in YAML either as a bare string (a block with no params,
// e.g. `- ddev-start`) or as a single-key object carrying that block's params
// (e.g. `- bash: { command: ... }`). We normalize both into a tagged union the
// runner can switch on. Only the blocks this slice needs are implemented;
// adding a block is: extend the union here + handle it in the runner.

export type Step
  = | { type: 'ddev-start' }
    | { type: 'bash', command: string, continueOnError: boolean }

const bashParams = z.object({
  'command': z.string().min(1),
  'continue-on-error': z.boolean().optional(),
})

// One raw YAML step → a normalized Step. Kept as a Zod transform so a bad
// definition fails validation with a useful path/message.
const stepSchema = z.union([
  z.literal('ddev-start').transform((): Step => ({ type: 'ddev-start' })),
  z.object({ bash: bashParams }).transform(({ bash }): Step => ({
    type: 'bash',
    command: bash.command,
    continueOnError: bash['continue-on-error'] ?? false,
  })),
])

const workflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  steps: z.array(stepSchema).min(1),
})

export type Workflow = z.infer<typeof workflowSchema>

// Parse + validate a workflow from its YAML source. Throws on invalid YAML or a
// definition that doesn't match the schema.
export function parseWorkflow(yaml: string): Workflow {
  return workflowSchema.parse(parse(yaml))
}
