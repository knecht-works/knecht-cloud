import { parse } from 'yaml'
import { z } from 'zod'
import { ensureStepIds, WORKFLOW_NAME_RE, type Step } from '../../shared/utils/workflow'
import { ACTIONS } from './actions'

export type { Step }

// The workflow definition format (workflows.md §10, mvp.md §3.2): a linear
// sequence of blocks. Both schemas below are assembled from the action registry
// (./actions) — adding a step type never touches this file.
//
// A step is written in YAML either as a bare string (a block with no params,
// e.g. `- ddev-start`) or as a single-key object carrying that block's params
// (e.g. `- bash: { command: ... }`). Each action's `yaml` schema normalizes its
// form into the tagged union the runner switches on.

// One raw YAML step → a normalized Step. Kept as Zod transforms so a bad
// definition fails validation with a useful path/message.
const stepSchema = z.union(
  ACTIONS.map(a => a.yaml) as [z.ZodType<Step>, z.ZodType<Step>, ...z.ZodType<Step>[]],
)

const workflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  // The YAML authoring form carries no ids — backfill deterministically.
  steps: z.array(stepSchema).min(1).transform(ensureStepIds),
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
const stepMeta = { id: z.string().optional(), label: z.string().optional(), description: z.string().optional() }
type StepOption = z.ZodObject<z.ZodRawShape>
const stepOptions = ACTIONS.map(a =>
  z.object({ type: z.literal(a.type), ...a.params, ...stepMeta }),
) as unknown as [StepOption, ...StepOption[]]
const normalizedStepSchema = z.discriminatedUnion('type', stepOptions) as unknown as z.ZodType<Step>

// Steps may be empty (a draft). The name rule lives in shared/utils/workflow.ts
// so the editor validates with the same regex.
export const workflowInputSchema = z.object({
  name: z.string().regex(WORKFLOW_NAME_RE, 'Letters, numbers, spaces, hyphens and underscores'),
  description: z.string().default(''),
  // Saves from pre-id clients (or hand-edited bodies) get ids backfilled, and
  // duplicates de-duplicated, before the steps hit the DB.
  steps: z.array(normalizedStepSchema).transform(ensureStepIds),
  // The automation master switch. Optional so the editor's full-body auto-saves
  // (which don't send it) leave the stored value untouched.
  enabled: z.boolean().optional(),
})

export type WorkflowInput = z.infer<typeof workflowInputSchema>
