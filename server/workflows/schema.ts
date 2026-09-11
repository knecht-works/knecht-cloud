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

const conditionSchema = z.object({
  left: z.string(),
  op: z.enum(CONDITION_OPS),
  right: z.string().optional(),
})

const yamlConditionsSchema = z.union([
  z.array(conditionSchema).min(1).transform(g => [g]),
  z.array(z.array(conditionSchema).min(1)).min(1),
])

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

const stepMeta = {
  id: z.string().regex(STEP_ID_RE, 'Step ids use lowercase letters, digits and underscores, starting with a letter').optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  continueOnError: z.boolean().optional(),
  timeoutSeconds: z.number().int().min(1).max(21600).optional(),
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

// Unknown keys pass through: the client diffs against the stored bytes.
const DRAFT_STEP_TYPES = [...ACTIONS.map(a => a.type), 'if', 'loop'] as unknown as [string, ...string[]]
const draftStepSchema: z.ZodType<Step> = z.lazy(() => z.looseObject({
  type: z.enum(DRAFT_STEP_TYPES),
  then: z.array(draftStepSchema).optional(),
  else: z.array(draftStepSchema).optional(),
  steps: z.array(draftStepSchema).optional(),
})) as unknown as z.ZodType<Step>
export const draftStepsSchema = z.array(draftStepSchema).superRefine(maxDepth)

export const publishStepsSchema = z.array(normalizedStepSchema)
  .min(1, 'Add at least one step before publishing')
  .superRefine(maxDepth)
  .transform(ensureStepIds)

export const workflowCreateSchema = z.object({
  name: z.string().regex(WORKFLOW_NAME_RE, 'Letters, numbers, spaces, hyphens and underscores').optional(),
  description: z.string().default(''),
})

export const workflowPatchSchema = z.object({
  name: z.string().regex(WORKFLOW_NAME_RE, 'Letters, numbers, spaces, hyphens and underscores').optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  repliesEnabled: z.boolean().optional(),
  draftSteps: draftStepsSchema.optional(),
})

export const WORKFLOW_FORMAT_VERSION = 1

const importedStepSchema = z.union([normalizedStepSchema, stepSchema])

export const workflowDocumentSchema = z.object({
  version: z.number().int().min(1)
    .max(WORKFLOW_FORMAT_VERSION, `This file uses a newer workflow format than this instance understands (max: ${WORKFLOW_FORMAT_VERSION})`)
    .default(1),
  name: z.string().regex(WORKFLOW_NAME_RE, 'Letters, numbers, spaces, hyphens and underscores'),
  description: z.string().default(''),
  steps: z.array(importedStepSchema).min(1).superRefine(maxDepth).transform(ensureStepIds),
})

export function parseWorkflow(source: string): Workflow {
  const doc = workflowDocumentSchema.parse(parse(source))
  return { name: doc.name, description: doc.description, steps: doc.steps }
}

export function serializeWorkflow(workflow: Workflow, format: 'yaml' | 'json'): string {
  const doc = {
    version: WORKFLOW_FORMAT_VERSION,
    name: workflow.name,
    description: workflow.description,
    steps: workflow.steps,
  }
  return format === 'json' ? `${JSON.stringify(doc, null, 2)}\n` : stringify(doc)
}
