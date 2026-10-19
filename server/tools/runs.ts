import { createError } from 'h3'
import { z } from 'zod'
import { stripAnsi } from '../../shared/utils/ansi'
import { getRunView, listRunViews, readRunLog, runLogBytes } from '../stores/runs'
import { listRunSteps, readStepLog } from '../stores/run-steps'
import { maskSecrets } from './redact'
import { defineTool } from './registry'

const RUN_STATUSES = ['queued', 'running', 'success', 'failed', 'cancelled'] as const

export const listRunsTool = defineTool({
  name: 'list_runs',
  description: 'Lists the most recent runs, newest first, optionally for one project or with one status.',
  scope: 'runs:read',
  input: z.object({
    projectId: z.number().int().optional(),
    status: z.enum(RUN_STATUSES).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  run: ({ projectId, status, limit }) => listRunViews(projectId, limit, status)
    .map(r => ({
      id: r.id,
      projectId: r.projectId,
      project: r.project,
      workflow: r.workflow,
      status: r.status,
      trigger: r.trigger,
      object: r.objectTitle,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
    })),
})

export const getRunTool = defineTool({
  name: 'get_run',
  description: 'Returns one run with its steps. Each step\'s id is what get_step_log takes. Header values and URL query values in step params are masked.',
  scope: 'runs:read',
  input: z.object({ runId: z.number().int() }),
  run: ({ runId }) => {
    const run = getRunView(runId)
    if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
    return {
      id: run.id,
      projectId: run.projectId,
      project: run.project,
      workflow: run.workflow,
      status: run.status,
      trigger: run.trigger,
      object: run.objectTitle && { title: run.objectTitle, url: run.objectUrl },
      branch: run.branch,
      prUrl: run.prUrl,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      steps: listRunSteps(runId).map(s => ({
        id: s.id,
        stepId: s.stepId,
        type: s.type,
        parentStepId: s.parentStepId,
        iteration: s.iteration,
        attempt: s.attempt,
        status: s.status,
        error: s.error,
        params: s.params && maskSecrets(s.params),
      })),
    }
  },
})

export const getStepLogTool = defineTool({
  name: 'get_step_log',
  description: 'Returns the log of one step of a run, ANSI codes removed. Long logs keep their end, where a failure shows.',
  scope: 'runs:read',
  input: z.object({
    runId: z.number().int(),
    stepId: z.number().int(),
    maxChars: z.number().int().min(1).max(100_000).default(24_000),
  }),
  run: ({ runId, stepId, maxChars }) => {
    const log = readStepLog(runId, stepId)
    if (log === undefined) throw createError({ statusCode: 404, statusMessage: 'No log for this step of this run' })
    const text = stripAnsi(log)
    const omitted = Math.max(0, text.length - maxChars)
    return { text: omitted ? text.slice(-maxChars) : text, omittedChars: omitted }
  },
})

export const getRunLogTool = defineTool({
  name: 'get_run_log',
  description: 'Returns the last maxBytes bytes of a run\'s whole log, ANSI codes removed. Use it when a run failed before any step, for example while preparing the environment.',
  scope: 'runs:read',
  input: z.object({
    runId: z.number().int(),
    maxBytes: z.number().int().min(1).max(100_000).default(24_000),
  }),
  run: ({ runId, maxBytes }) => {
    if (!getRunView(runId)) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
    const omittedBytes = Math.max(0, runLogBytes(runId) - maxBytes)
    return { text: stripAnsi(readRunLog(runId, omittedBytes).text), omittedBytes }
  },
})
