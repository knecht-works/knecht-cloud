import { z } from 'zod'
import { listWorkflowRows, requireWorkflowRow } from '../stores/workflows'
import { serializeWorkflow } from '../workflows/schema'
import { ensureStepIds } from '../../shared/utils/workflow'
import { maskStepSecrets } from './redact'
import { defineTool } from './registry'

export const listWorkflowsTool = defineTool({
  name: 'list_workflows',
  description: 'Lists the workflows. Only published, enabled workflows can be started by a trigger.',
  scope: 'workflows:read',
  input: z.object({}),
  run: () => listWorkflowRows().map(w => ({
    id: w.id,
    name: w.name,
    description: w.description,
    enabled: w.enabled,
    published: w.publishedAt !== null,
    hasDraft: w.draftSteps !== null,
  })),
})

export const getWorkflowTool = defineTool({
  name: 'get_workflow',
  description: 'Returns one workflow as a YAML document in the format describe_workflow_format explains: the published version and, if one exists, the unpublished draft. Header values and URL query values of http steps are masked.',
  scope: 'workflows:read',
  input: z.object({ workflowId: z.number().int() }),
  run: ({ workflowId }) => {
    const w = requireWorkflowRow(workflowId)
    const doc = (steps: typeof w.steps) => serializeWorkflow({ name: w.name, description: w.description, steps: maskStepSecrets(ensureStepIds(steps)) }, 'yaml')
    return {
      id: w.id,
      enabled: w.enabled,
      published: w.publishedAt && doc(w.steps),
      draft: w.draftSteps && doc(w.draftSteps),
    }
  },
})
