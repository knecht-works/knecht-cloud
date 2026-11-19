import { z } from 'zod'
import { defineAiFeature, runAiFeature } from '#server/utils/ai-feature'
import { updateRun } from '#server/stores/runs'
import { getSettings } from '#server/utils/settings'
import type { ToolContext } from '#server/tools/registry'

const SYSTEM: ToolContext = { actor: { kind: 'system' }, channel: 'daemon' }
const MAX_TITLE_CHARS = 80

const runTitle = defineAiFeature({
  id: 'run-title',
  model: 'fast',
  instructions: `You name a task someone gave a coding agent in a comment or chat message, so it can be found in a list of runs.
Answer with a short imperative title of at most 60 characters, in the language of the message, for example "Fix hover color of footer links".
Plain text: no quotes, no trailing period, no mention of the agent or the person asking.`,
  tools: [],
  output: z.object({ title: z.string() }),
  maxSteps: 1,
})

export async function titleRun(runId: number, prompt: string): Promise<void> {
  const settings = getSettings()
  if (!settings.aiKeyEnc || !settings.aiModel) return
  try {
    const { title } = await runAiFeature(runTitle, prompt, SYSTEM, {
      maxOutputTokens: 100,
      abortSignal: AbortSignal.timeout(30_000),
    })
    const clean = title.trim().replace(/^["'„“]+|["'“”.]+$/g, '').slice(0, MAX_TITLE_CHARS)
    if (clean) updateRun(runId, { title: clean })
  }
  catch (e) {
    console.warn(`[run-title] run ${runId} skipped:`, (e as Error).message)
  }
}
