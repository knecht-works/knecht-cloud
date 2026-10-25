import { generateText, Output } from 'ai'
import { languageModel } from '../utils/llm'
import { buildDiagnosisPrompt, DIAGNOSIS_INSTRUCTIONS, diagnosisSchema, stepLabel } from '../utils/run-diagnosis'
import { getRunView, setRunDiagnosis } from '../stores/runs'
import { getSettings } from '../utils/settings'
import { callTool, type ToolContext } from '../tools/registry'
import { getRunLogTool, getRunTool, getStepLogTool } from '../tools/runs'
import { isCompositeType, type Step } from '../../shared/utils/workflow'

const SYSTEM: ToolContext = { actor: { kind: 'system' }, channel: 'daemon' }
const MAX_SUMMARY_CHARS = 280

export async function diagnoseRunFailure(runId: number): Promise<void> {
  const settings = getSettings()
  const finishedAt = getRunView(runId)?.finishedAt
  if (!settings.aiKeyEnc || !settings.aiModel || !finishedAt) return
  setRunDiagnosis(runId, finishedAt, { state: 'pending' })
  try {
    const run = await callTool(getRunTool, { runId }, SYSTEM)
    // A failed if/loop row only wraps its failed child, whose own row carries the log.
    const failed = run.steps.filter(s => s.status === 'failed' && !isCompositeType(s.type as Step['type']))
    const stepLogs = new Map(await Promise.all(failed.map(async s => [
      s.id,
      await callTool(getStepLogTool, { runId, stepId: s.id }, SYSTEM).then(l => l.text, () => ''),
    ] as const)))
    // A failure before the first step (e.g. while preparing the environment) has no failed step row.
    const runLogTail = failed.length ? undefined : (await callTool(getRunLogTool, { runId }, SYSTEM)).text

    const { output } = await generateText({
      model: await languageModel('fast'),
      instructions: DIAGNOSIS_INSTRUCTIONS,
      prompt: buildDiagnosisPrompt(run.workflow, run.steps, stepLogs, runLogTail),
      output: Output.object({ schema: diagnosisSchema }),
      maxOutputTokens: 400,
      abortSignal: AbortSignal.timeout(60_000),
    })
    const cited = output.stepIds.flatMap(id => run.steps.find(s => s.id === id) ?? [])
    setRunDiagnosis(runId, finishedAt, {
      state: 'done',
      summary: output.summary.trim().slice(0, MAX_SUMMARY_CHARS),
      steps: (cited.length ? cited : failed).slice(0, 3).map(s => ({ id: s.id, stepId: s.stepId, label: stepLabel(s) })),
    })
  }
  catch (e) {
    console.warn(`[failure-diagnosis] run ${runId} skipped:`, (e as Error).message)
    setRunDiagnosis(runId, finishedAt, null)
  }
}
