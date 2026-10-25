import { z } from 'zod'

const MAX_PARAMS_CHARS = 2_000

export const DIAGNOSIS_INSTRUCTIONS = `You explain why a run of Knecht failed. Knecht runs workflows of steps (shell commands, AI agent steps, git and PR actions) against a project in a DDEV sandbox.
From the steps and logs you are given, state the root cause and the most likely fix in one or two short sentences, at most 200 characters in total.
The summary is plain text: no Markdown, no quotes of whole log lines, no preamble. If the log does not show the cause, say what failed and that the log does not say why.
If the failed step's log does not show the cause, read the logs of earlier steps or the workflow with the tools before you answer.
In stepIds, list the ids (the numbers in brackets) of the steps whose log shows the cause, most relevant first; usually that is the failed step.`

export const diagnosisSchema = z.object({
  summary: z.string(),
  stepIds: z.array(z.number().int()),
})

export interface DiagnosisStep {
  id: number
  stepId: string
  type: string
  status: string
  error: string | null
  params: Record<string, unknown> | null
  iteration: number | null
  attempt: number
}

export function stepLabel(s: Pick<DiagnosisStep, 'stepId' | 'iteration'>): string {
  return s.iteration === null ? s.stepId : `${s.stepId} #${s.iteration + 1}`
}

// stepLogs holds the failed steps' logs; runLogTail stands in when no step failed.
export function buildDiagnosisPrompt(
  run: { id: number, workflow: string, workflowId: number | null, steps: DiagnosisStep[] },
  stepLogs: Map<number, string>,
  runLogTail?: string,
): string {
  const { steps } = run
  const overview = steps.map(s => `- ${label(s)}: ${s.status}${s.error ? `, error: ${s.error}` : ''}`)
  const sections = steps.filter(s => stepLogs.has(s.id)).map((s) => {
    const params = s.params ? truncateEnd(JSON.stringify(s.params, null, 2), MAX_PARAMS_CHARS) : 'none'
    return `## Failed step ${label(s)}\n\nParams:\n${params}\n\nLog:\n${stepLogs.get(s.id) || '(no log captured)'}`
  })
  if (runLogTail !== undefined) sections.push(`## Log tail\n\n${runLogTail}`)

  const workflow = run.workflowId === null ? run.workflow : `${run.workflow} (id ${run.workflowId})`
  return [`Run id: ${run.id}`, `Workflow: ${workflow}`, `Steps:\n${overview.join('\n') || '- none ran'}`, ...sections].join('\n\n')
}

function label(s: DiagnosisStep): string {
  const attempt = s.attempt > 1 ? `, attempt ${s.attempt}` : ''
  return `[${s.id}] ${stepLabel(s)} (${s.type}${attempt})`
}

function truncateEnd(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[... truncated]` : text
}
