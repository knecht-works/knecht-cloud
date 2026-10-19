import { z } from 'zod'
import { publishStepsSchema, WORKFLOW_FORMAT_VERSION } from '../workflows/schema'
import glossary from '../../CONTEXT.md'
import { defineTool } from './registry'

export const describeWorkflowFormatTool = defineTool({
  name: 'describe_workflow_format',
  description: 'Returns the JSON Schema of a workflow document, including every step type and its parameters.',
  scope: 'knowledge:read',
  input: z.object({}),
  run: () => z.toJSONSchema(z.object({
    version: z.literal(WORKFLOW_FORMAT_VERSION),
    name: z.string(),
    description: z.string(),
    steps: publishStepsSchema,
  }), { io: 'input', unrepresentable: 'any' }),
})

export const glossaryTool = defineTool({
  name: 'glossary',
  description: 'Returns Knecht\'s glossary: what workflows, triggers, runs, sessions, projects and the other domain terms mean.',
  scope: 'knowledge:read',
  input: z.object({}),
  run: () => glossary,
})
