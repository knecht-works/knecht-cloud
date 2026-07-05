import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { getSettings } from '../../utils/settings'
import { decrypt } from '../../utils/crypto'
import { defineAction, ActionError } from './types'

// The `ai` step (the "knecht block"): one LLM call via OpenRouter. Key and
// default model live in settings (Settings → Agent); a step can override the
// model. Runs host-side — it's a plain HTTPS call, nothing enters the sandbox.
export const aiAction = defineAction({
  type: 'ai',
  params: {
    prompt: z.string().min(1),
    system: z.string().optional(),
    model: z.string().optional(),
  },
  yaml: z.object({
    ai: z.object({
      prompt: z.string().min(1),
      system: z.string().optional(),
      model: z.string().optional(),
    }),
  }).transform(({ ai }): Step => ({ type: 'ai', ...ai })),
  async run(step, rt) {
    const settings = getSettings()
    if (!settings.openrouterKeyEnc) {
      throw new Error('OpenRouter API key not configured — add it under Settings → Agent')
    }
    const model = step.model?.trim() || settings.aiModel
    rt.log(`\n▶ ai (${model}): ${oneLine(step.prompt, 100)}\n`)

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${decrypt(settings.openrouterKeyEnc)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(step.system ? [{ role: 'system', content: step.system }] : []),
          { role: 'user', content: step.prompt },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    })
    if (!res.ok) {
      const detail = oneLine(await res.text().catch(() => ''), 300)
      throw new ActionError(`OpenRouter request failed (${res.status}): ${detail}`, { status: res.status })
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content ?? ''
    if (!text) throw new Error('OpenRouter returned an empty response')
    rt.log(`${text}\n`)

    // Expose a parsed form when the model answered with JSON (a common pattern
    // for feeding a js/http step) — code fences stripped first.
    const json = tryParseJson(text)
    return json === undefined ? { text } : { text, json }
  },
})

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function tryParseJson(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(stripped)
  }
  catch {
    return undefined
  }
}
