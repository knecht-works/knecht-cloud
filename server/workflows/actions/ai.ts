import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { getSettings } from '../../utils/settings'
import { decrypt } from '../../utils/crypto'
import { tryParseJson } from '../../utils/json'
import { defineAction, ActionError } from './types'

// The `ai` step (the "knecht block"): an opencode run INSIDE the run's sandbox,
// working on the project checkout — a real agent that can read/edit files and
// execute commands, not a bare chat call. opencode is baked into the sandbox
// image (sandbox/Dockerfile); the provider API key and default model live in
// settings (Settings → Agent), a step can override the model.

// Which env var hands the configured key to opencode, by the model's provider
// prefix. Ids and env names follow models.dev — the registry opencode resolves
// providers from ('opencode' is Zen); google accepts several names, set all.
export const PROVIDER_KEY_ENV: Record<string, string[]> = {
  opencode: ['OPENCODE_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  groq: ['GROQ_API_KEY'],
}

// provider/model — the model part may itself contain slashes (openrouter/
// anthropic/claude-…). Every segment shell-safe: doubles as the guard that
// lets the model string be embedded in the bash command line below.
const MODEL_RE = /^[\w.-]+(\/[\w.:-]+)+$/

export const aiAction = defineAction({
  type: 'ai',
  params: {
    prompt: z.string().min(1),
    model: z.string().optional(),
  },
  async run(step, rt) {
    const settings = getSettings()
    if (!settings.aiKeyEnc) {
      throw new Error('AI provider API key not configured — add it under Settings → Agent')
    }
    const model = step.model?.trim() || settings.aiModel
    if (!MODEL_RE.test(model)) {
      throw new Error(`Invalid model '${model}' — expected opencode's provider/model form, e.g. anthropic/claude-sonnet-4-5`)
    }
    const provider = model.split('/')[0]!
    const envNames = PROVIDER_KEY_ENV[provider]
    if (!envNames) {
      throw new Error(`Unsupported provider '${provider}' — supported: ${Object.keys(PROVIDER_KEY_ENV).join(', ')}`)
    }
    rt.log(`\n▶ ai (${model}): ${oneLine(step.prompt, 100)}\n`)
    await rt.sandbox.ensureUp()

    // The prompt travels as a file (js-step pattern) — no shell quoting of user
    // text; $(cat …) inside double quotes is safe.
    const dir = await mkdtemp(join(tmpdir(), 'knecht-ai-'))
    try {
      const hostFile = join(dir, 'prompt.txt')
      await writeFile(hostFile, step.prompt)
      const inSandbox = `/tmp/knecht-ai-${rt.runId}.txt`
      await rt.sandbox.copyIn(hostFile, inSandbox)
      const key = decrypt(settings.aiKeyEnc)
      const { code, tail } = await rt.sandbox.stream(
        ['bash', '-lc', `opencode run --model ${model} "$(cat ${inSandbox})"`],
        { env: Object.fromEntries(envNames.map(name => [name, key])) },
      )
      if (code !== 0) throw new ActionError(`opencode exited with code ${code}`, { exitCode: code })
      const text = tail.trim()
      if (!text) throw new Error('opencode produced no output')

      // Expose a parsed form when the agent answered with pure JSON (a common
      // pattern for feeding a js/http step) — code fences stripped first.
      const json = tryParseJson(stripFences(text))
      return json === undefined ? { text } : { text, json }
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
})

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
}
