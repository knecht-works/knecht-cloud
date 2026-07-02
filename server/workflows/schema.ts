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

// Optional per-step metadata the visual builder can set: a custom display name
// (`label`) and a note (`description`). They don't affect execution — the runner
// switches on `type` — they're just for the builder/overview.
export interface StepMeta {
  label?: string
  description?: string
}

export type Step = StepMeta & (
  | { type: 'ddev-start' }
  | { type: 'bash', command: string, continueOnError: boolean }
  | { type: 'create-branch', name: string }
  | { type: 'create-commit', message: string }
  | { type: 'create-pr', title: string, body: string }
)

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
  z.object({ 'create-branch': z.object({ name: z.string().min(1) }) })
    .transform(({ 'create-branch': p }): Step => ({ type: 'create-branch', name: p.name })),
  z.object({ 'create-commit': z.object({ message: z.string().min(1) }) })
    .transform(({ 'create-commit': p }): Step => ({ type: 'create-commit', message: p.message })),
  z.object({ 'create-pr': z.object({ title: z.string().min(1), description: z.string().default('') }) })
    .transform(({ 'create-pr': p }): Step => ({ type: 'create-pr', title: p.title, body: p.description })),
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

// Validation for workflows coming from the visual builder (the API). Unlike
// `stepSchema` (which parses the YAML authoring form), the builder sends steps
// already in their NORMALIZED, `type`-tagged shape — so this validates that
// shape directly. Required params are enforced (a half-filled step can't save).
const stepMeta = { label: z.string().optional(), description: z.string().optional() }
const normalizedStepSchema: z.ZodType<Step> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ddev-start'), ...stepMeta }),
  z.object({
    type: z.literal('bash'),
    command: z.string().min(1),
    continueOnError: z.boolean().default(false),
    ...stepMeta,
  }),
  z.object({ type: z.literal('create-branch'), name: z.string().min(1), ...stepMeta }),
  z.object({ type: z.literal('create-commit'), message: z.string().min(1), ...stepMeta }),
  z.object({ type: z.literal('create-pr'), title: z.string().min(1), body: z.string().default(''), ...stepMeta }),
])

// A workflow name doubles as its URL segment and the `runs.workflow` reference.
// It's a free-form friendly name (spaces allowed), constrained only to what's
// URL-safe once encoded — no slash/percent/etc. Steps may be empty (a draft).
export const workflowInputSchema = z.object({
  name: z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u, 'Letters, numbers, spaces, hyphens and underscores'),
  description: z.string().default(''),
  steps: z.array(normalizedStepSchema),
  // The automation master switch. Optional so the editor's full-body auto-saves
  // (which don't send it) leave the stored value untouched.
  enabled: z.boolean().optional(),
})

export type WorkflowInput = z.infer<typeof workflowInputSchema>
