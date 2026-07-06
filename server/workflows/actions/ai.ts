import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { type AiOutputField, type AiOutputType, parseAiOutputSpec } from '../../../shared/utils/workflow'
import type { AiProviderId } from '../../../shared/utils/ai'
import { getSettings } from '../../utils/settings'
import { decrypt } from '../../utils/crypto'
import { tryParseJson } from '../../utils/json'
import { defineAction, ActionError } from './types'
import type { ActionRuntime } from './types'

// The `ai` step (the "knecht block"): an opencode run INSIDE the run's sandbox,
// working on the project checkout: a real agent that can read/edit files and
// execute commands, not a bare chat call. opencode is baked into the sandbox
// image (sandbox/Dockerfile); the provider API key and default model live in
// settings (Settings → Agent), a step can override the model.

// Which env var hands the configured key to opencode, per AI_PROVIDERS id
// (shared/utils/ai.ts). Env names follow models.dev, the registry opencode
// resolves providers from; google accepts several names, set all.
const PROVIDER_KEY_ENV: Record<AiProviderId, string[]> = {
  opencode: ['OPENCODE_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
}

// provider/model (the model part may itself contain slashes), every segment
// shell-safe: doubles as the guard that lets the model string be embedded in
// the bash command line below.
const MODEL_RE = /^[\w.-]+(\/[\w.:-]+)+$/

// opencode runs as ddev with HOME=/home/ddev (daemon/sandbox.ts), so it reads
// its config from here. The per-step `system` prompt is dropped into workflow.md
// each run; a baked opencode.json merges it into opencode's instructions
// (sandbox/Dockerfile). Always (over)written, empty when unset, so one ai step's
// system prompt never leaks into a later ai step sharing the same sandbox.
const OPENCODE_CONFIG_DIR = '/home/ddev/.config/opencode'
const WORKFLOW_SYSTEM_PATH = `${OPENCODE_CONFIG_DIR}/workflow.md`

// Structured output: how many times we re-ask the agent (continuing the same
// session, so it fixes the file rather than redoing the work) before failing.
const MAX_OUTPUT_ATTEMPTS = 3

export const aiAction = defineAction({
  type: 'ai',
  params: {
    prompt: z.string().min(1),
    model: z.string().optional(),
    system: z.string().optional(),
    // A field spec, `name: type` per line. Validated here so a bad spec is an
    // authoring error, not a run-time surprise; parseAiOutputSpec throws the
    // line-precise message the runtime path relies on.
    output: z.string().optional().refine(
      v => v === undefined || isValidOutputSpec(v),
      { message: 'output must be lines of `name: type` (types: string, number, boolean, or their [] arrays)' },
    ),
  },
  async run(step, rt) {
    const settings = getSettings()
    if (!settings.aiKeyEnc) {
      throw new Error('AI provider API key not configured, add it under Settings → Agent')
    }
    const model = step.model?.trim() || settings.aiModel
    if (!MODEL_RE.test(model)) {
      throw new Error(`Invalid model '${model}': expected opencode's provider/model form, e.g. anthropic/claude-sonnet-4-5`)
    }
    // The key belongs to the CONFIGURED provider; a model from another one
    // would run against credentials that can't serve it.
    const provider = settings.aiProvider as AiProviderId
    const envNames = PROVIDER_KEY_ENV[provider]
    if (!envNames) {
      throw new Error(`Unsupported provider '${provider}'. Supported: ${Object.keys(PROVIDER_KEY_ENV).join(', ')}`)
    }
    if (model.split('/')[0] !== provider) {
      throw new Error(`Model '${model}' does not match the configured provider '${provider}' (Settings → Agent)`)
    }
    rt.log(`\n▶ ai (${model}): ${oneLine(step.prompt, 100)}\n`)
    await rt.sandbox.ensureUp()

    const key = decrypt(settings.aiKeyEnc)
    const env = Object.fromEntries(envNames.map(name => [name, key]))
    const dir = await mkdtemp(join(tmpdir(), 'knecht-ai-'))
    try {
      // Reset the merged-in system prompt for THIS step (empty when unset).
      await writeSystemPrompt(rt, dir, step.system ?? '')

      if (!step.output) {
        const text = await runOpencode(rt, dir, model, env, step.prompt, false)
        // Expose a parsed form when the agent answered with pure JSON (a common
        // pattern for feeding a js/http step); code fences stripped first.
        const json = tryParseJson(stripFences(text))
        return json === undefined ? { text } : { text, json }
      }
      return await runWithOutput(rt, dir, model, env, step.prompt, step.output)
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
})

// The structured-output path: run, read the file the agent was told to write,
// validate against the spec, and on a miss re-ask (same session) with the exact
// error until it passes or MAX_OUTPUT_ATTEMPTS is spent.
async function runWithOutput(
  rt: ActionRuntime,
  dir: string,
  model: string,
  env: Record<string, string>,
  prompt: string,
  spec: string,
): Promise<{ text: string, json: unknown }> {
  const fields = parseAiOutputSpec(spec)
  const schema = outputSchema(fields)
  const outPath = `/tmp/knecht-ai-out-${rt.runId}.json`
  const shape = describeShape(fields)

  let message = `${prompt}\n\n${outputInstruction(shape, outPath)}`
  let lastError = ''
  for (let attempt = 1; attempt <= MAX_OUTPUT_ATTEMPTS; attempt++) {
    const text = await runOpencode(rt, dir, model, env, message, attempt > 1)
    const read = await readOutputFile(rt, outPath)
    if (read.ok) {
      const parsed = schema.safeParse(read.value)
      if (parsed.success) return { text, json: parsed.data }
      lastError = formatZodError(parsed.error)
    }
    else {
      lastError = read.error
    }
    rt.log(`\nai output attempt ${attempt}/${MAX_OUTPUT_ATTEMPTS} did not match the schema: ${lastError}\n`)
    message = correctionInstruction(shape, outPath, lastError)
  }
  throw new ActionError(`ai output did not match the schema after ${MAX_OUTPUT_ATTEMPTS} attempts: ${lastError}`)
}

// One opencode invocation. The prompt travels as a file (no shell quoting of
// user text; $(cat …) inside double quotes is safe); `continueSession` resumes
// the run's prior opencode session (-c) so a retry corrects instead of redoing.
async function runOpencode(
  rt: ActionRuntime,
  dir: string,
  model: string,
  env: Record<string, string>,
  message: string,
  continueSession: boolean,
): Promise<string> {
  const hostFile = join(dir, 'prompt.txt')
  await writeFile(hostFile, message)
  const inSandbox = `/tmp/knecht-ai-${rt.runId}.txt`
  await rt.sandbox.copyIn(hostFile, inSandbox)
  // --auto: auto-approve tool permissions. A workflow agent is non-interactive,
  // so without it file writes and bash calls get rejected and the run stalls.
  const cont = continueSession ? '--continue ' : ''
  const { code, tail } = await rt.sandbox.stream(
    ['bash', '-lc', `opencode run --auto ${cont}--model ${model} "$(cat ${inSandbox})"`],
    { env },
  )
  if (code !== 0) throw new ActionError(`opencode exited with code ${code}`, { exitCode: code })
  const text = tail.trim()
  if (!text) throw new Error('opencode produced no output')
  return text
}

// Read the file the agent was asked to write. Read it with exec (cat), NOT
// docker cp: under the sysbox runtime, docker cp can't see files the agent wrote
// into the container's /tmp, but exec always can. Reading a dedicated file (not
// scraping the agent's chatty stdout) is what keeps structured output reliable.
// Missing/non-JSON are recoverable misses that drive a retry, not hard errors.
async function readOutputFile(
  rt: ActionRuntime,
  sandboxPath: string,
): Promise<{ ok: true, value: unknown } | { ok: false, error: string }> {
  const { code, tail } = await rt.sandbox.stream(['cat', sandboxPath])
  if (code !== 0) return { ok: false, error: `no output file was written to ${sandboxPath}` }
  const value = tryParseJson(tail.trim())
  if (value === undefined) return { ok: false, error: 'output file was not valid JSON' }
  return { ok: true, value }
}

async function writeSystemPrompt(rt: ActionRuntime, dir: string, system: string): Promise<void> {
  const hostFile = join(dir, 'system.md')
  await writeFile(hostFile, system)
  // docker cp only reaches MOUNTED paths in a sysbox container (/tmp, /project),
  // not the image rootfs like /home/ddev (daemon/sandbox.ts). So stage into /tmp
  // via copyIn, then move it into place with exec, which sees the whole fs. The
  // baked opencode.json is what merges this file into opencode's instructions.
  const staged = `/tmp/knecht-ai-system-${rt.runId}.md`
  await rt.sandbox.copyIn(hostFile, staged)
  const { code } = await rt.sandbox.stream(['sh', '-c', `mkdir -p ${OPENCODE_CONFIG_DIR} && cp ${staged} ${WORKFLOW_SYSTEM_PATH}`])
  if (code !== 0) throw new ActionError(`failed to stage the system prompt into ${WORKFLOW_SYSTEM_PATH}`)
}

// ── output spec ──────────────────────────────────────────────────────────────
// The `name: type` grammar lives in shared/utils/workflow.ts (parseAiOutputSpec)
// so the builder's variable picker reads the exact same fields; here we turn it
// into a zod schema and validate the agent's answer against it.

function isValidOutputSpec(text: string): boolean {
  try {
    parseAiOutputSpec(text)
    return true
  }
  catch {
    return false
  }
}

function outputSchema(fields: AiOutputField[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) shape[f.name] = fieldSchema(f.type)
  return z.object(shape)
}

function fieldSchema(type: AiOutputType): z.ZodTypeAny {
  switch (type) {
    case 'string': return z.string()
    case 'number': return z.number()
    case 'boolean': return z.boolean()
    case 'string[]': return z.array(z.string())
    case 'number[]': return z.array(z.number())
    case 'boolean[]': return z.array(z.boolean())
  }
}

function describeShape(fields: AiOutputField[]): string {
  return `{\n${fields.map(f => `  "${f.name}": <${f.type}>`).join(',\n')}\n}`
}

function outputInstruction(shape: string, path: string): string {
  return [
    `When you are done, write your result as a single JSON object to the file \`${path}\`.`,
    `Write ONLY that file, and do not print the JSON to stdout.`,
    `The JSON must match exactly this shape:`,
    shape,
  ].join('\n')
}

function correctionInstruction(shape: string, path: string, error: string): string {
  return [
    `The JSON you wrote to \`${path}\` did not match the required shape: ${error}.`,
    `The task changes are already done, do NOT redo them.`,
    `Overwrite \`${path}\` with a corrected JSON object matching exactly this shape:`,
    shape,
  ].join('\n')
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
}
