import { parse, stringify } from 'yaml'
import { z } from 'zod'
import {
  CONDITION_OPS,
  ensureStepIds,
  MAX_STEP_DEPTH,
  STEP_ID_RE,
  stepTreeDepth,
  WORKFLOW_NAME_RE,
  type Step,
} from '../../shared/utils/workflow'
import { ACTIONS } from './actions'

export type { Step }

// The workflow definition format (workflows.md §10, mvp.md §3.2): a linear
// sequence of blocks. Both schemas below are assembled from the action registry
// (./actions). Adding a plain step type never touches this file. The composite
// control-flow steps (if/loop) are defined here because they are engine-level
// constructs whose schemas recurse into the step schema itself.
//
// A step is written in YAML either as a bare string (a block with no params,
// e.g. `- ddev-start`) or as a single-key object carrying that block's params
// (e.g. `- bash: { command: ... }`). Each action's `yaml` schema normalizes its
// form into the tagged union the runner switches on.

const conditionSchema = z.object({
  left: z.string(),
  op: z.enum(CONDITION_OPS),
  right: z.string().optional(),
})

// The YAML authoring sugar accepts a flat condition list (one AND group) or
// the full OR-of-ANDs form; both normalize to Condition[][].
const yamlConditionsSchema = z.union([
  z.array(conditionSchema).min(1).transform(g => [g]),
  z.array(z.array(conditionSchema).min(1)).min(1),
])

// One raw YAML step → a normalized Step. Kept as Zod transforms so a bad
// definition fails validation with a useful path/message.
const stepSchema: z.ZodType<Step> = z.union([
  ...(ACTIONS.map(a => a.yaml) as [z.ZodType<Step>, z.ZodType<Step>, ...z.ZodType<Step>[]]),
  z.object({
    if: z.object({
      conditions: yamlConditionsSchema,
      then: z.array(z.lazy(() => stepSchema)).default([]),
      else: z.array(z.lazy(() => stepSchema)).default([]),
    }),
  }).transform(({ if: p }): Step => ({ type: 'if', conditions: p.conditions, then: p.then, else: p.else })),
  z.object({
    loop: z.object({
      items: z.string().min(1),
      steps: z.array(z.lazy(() => stepSchema)).default([]),
    }),
  }).transform(({ loop: p }): Step => ({ type: 'loop', items: p.items, steps: p.steps })),
])

const maxDepth = (steps: Step[], ctx: z.RefinementCtx) => {
  if (stepTreeDepth(steps) > MAX_STEP_DEPTH) {
    ctx.addIssue({ code: 'custom', message: `Steps nest deeper than ${MAX_STEP_DEPTH} levels` })
  }
}

export interface Workflow {
  name: string
  description: string
  steps: Step[]
}

// Validation for workflows coming from the visual builder (the API). Unlike
// `stepSchema` (which parses the YAML authoring form), the builder sends steps
// already in their NORMALIZED, `type`-tagged shape, so this validates that
// shape directly. Required params are enforced (a half-filled step can't save).
const stepMeta = {
  // Ids are template path segments (STEP_ID_RE); ensureStepIds backfills
  // missing ones and de-duplicates, so only the FORMAT is enforced here.
  id: z.string().regex(STEP_ID_RE, 'Step ids use lowercase letters, digits and underscores, starting with a letter').optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  // The step's error policy (shared/utils/workflow.ts StepMeta), enforced by
  // the runner for every step type.
  continueOnError: z.boolean().optional(),
  retry: z.object({
    attempts: z.number().int().min(1).max(10),
    backoffSeconds: z.number().min(0).max(3600),
  }).optional(),
}
type StepOption = z.ZodObject<z.ZodRawShape>
const stepOptions = [
  ...ACTIONS.map(a => z.object({ type: z.literal(a.type), ...a.params, ...stepMeta })),
  z.object({
    type: z.literal('if'),
    conditions: z.array(z.array(conditionSchema)),
    then: z.array(z.lazy(() => normalizedStepSchema)).default([]),
    else: z.array(z.lazy(() => normalizedStepSchema)).default([]),
    ...stepMeta,
  }),
  z.object({
    type: z.literal('loop'),
    items: z.string().min(1),
    steps: z.array(z.lazy(() => normalizedStepSchema)).default([]),
    ...stepMeta,
  }),
] as unknown as [StepOption, ...StepOption[]]
const normalizedStepSchema = z.discriminatedUnion('type', stepOptions) as unknown as z.ZodType<Step>

// Steps may be empty (a draft). The name rule lives in shared/utils/workflow.ts
// so the editor validates with the same regex.
export const workflowInputSchema = z.object({
  name: z.string().regex(WORKFLOW_NAME_RE, 'Letters, numbers, spaces, hyphens and underscores'),
  description: z.string().default(''),
  // Saves from pre-id clients (or hand-edited bodies) get ids backfilled, and
  // duplicates de-duplicated, before the steps hit the DB.
  steps: z.array(normalizedStepSchema).superRefine(maxDepth).transform(ensureStepIds),
  // The automation master switch. Optional so the editor's full-body auto-saves
  // (which don't send it) leave the stored value untouched.
  enabled: z.boolean().optional(),
})

export type WorkflowInput = z.infer<typeof workflowInputSchema>

// ── import / export (workflow-engine-plan.md D9) ─────────────────────────────
// The normalized JSON shape is canonical; YAML is the same document serialized.
// The envelope carries an integer format version: older exports migrate here
// as the format evolves (none yet: v1 is the first), newer ones are rejected
// with a clear message instead of being half-read.
export const WORKFLOW_FORMAT_VERSION = 1

// Import accepts steps in BOTH forms: the explicit normalized shape that
// exports write, and the terse authoring sugar for hand-written files.
const importedStepSchema = z.union([normalizedStepSchema, stepSchema])

export const workflowDocumentSchema = z.object({
  version: z.number().int().min(1)
    .max(WORKFLOW_FORMAT_VERSION, `This file uses a newer workflow format than this instance understands (max: ${WORKFLOW_FORMAT_VERSION})`)
    .default(1),
  name: z.string().regex(WORKFLOW_NAME_RE, 'Letters, numbers, spaces, hyphens and underscores'),
  description: z.string().default(''),
  steps: z.array(importedStepSchema).min(1).superRefine(maxDepth).transform(ensureStepIds),
})

// Parse + validate a workflow from its YAML (or JSON, since YAML is a superset)
// source. Throws on invalid input; used for the bundled starter templates.
// The import API uses `workflowDocumentSchema` directly for path-precise errors.
export function parseWorkflow(source: string): Workflow {
  const doc = workflowDocumentSchema.parse(parse(source))
  return { name: doc.name, description: doc.description, steps: doc.steps }
}

// Serialize a workflow to its export document: the explicit normalized step
// form (ids included, so an export→import round-trip is identity), wrapped in
// the version envelope.
export function serializeWorkflow(workflow: Workflow, format: 'yaml' | 'json'): string {
  const doc = {
    version: WORKFLOW_FORMAT_VERSION,
    name: workflow.name,
    description: workflow.description,
    steps: workflow.steps,
  }
  return format === 'json' ? `${JSON.stringify(doc, null, 2)}\n` : stringify(doc)
}
