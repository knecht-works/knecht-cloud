import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { type AiOutputField, type AiOutputType, parseAiOutputSpec } from '../../../shared/utils/workflow'
import { type AiProviderId, MODEL_NAME_RE, stripLegacyModelPrefix } from '../../../shared/utils/ai'
import { getSettings } from '../../utils/settings'
import { decrypt } from '../../utils/crypto'
import { tryParseJson } from '../../utils/json'
import { bridgeEnv } from '../../utils/knecht-env'
import { persistAgentMemory, seedAgentMemory } from '../../utils/agent-memory'
import { agentModelRef, buildAgentRules, buildOpencodeConfig } from '../../utils/opencode-config'
import { readSandboxAsset } from '../../utils/sandbox-assets'
import { defineAction, ActionError } from './types'
import type { ActionRuntime } from './types'

// Env names follow models.dev; google accepts several, set all.
const PROVIDER_KEY_ENV: Record<AiProviderId, string[]> = {
  'opencode': ['OPENCODE_API_KEY'],
  'opencode-go': ['OPENCODE_API_KEY'],
  'anthropic': ['ANTHROPIC_API_KEY'],
  'openai': ['OPENAI_API_KEY'],
  'google': ['GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
  'langdock': ['LANGDOCK_API_KEY'],
}

// Every segment shell-safe: the model string is embedded in the bash command line below.
const MODEL_RE = /^[\w.-]+(\/[\w.:-]+)+$/

// workflow.md is always (over)written so one ai step's prompt never leaks into a later one.
const AGENT_CONFIG_SUBDIR = join('.knecht', 'opencode')

const MAX_OUTPUT_ATTEMPTS = 3

export const aiAction = defineAction({
  type: 'ai',
  params: {
    prompt: z.string().min(1),
    model: z.string().optional(),
    system: z.string().optional(),
    output: z.string().optional().refine(
      v => v === undefined || isValidOutputSpec(v),
      { message: 'output must be lines of `name: type` (types: string, number, boolean, or their [] arrays)' },
    ),
  },
  async run(step, rt) {
    const { model, bareModel, env } = await resolveAgentEnv(rt.sessionId, step.model)
    rt.log(`\n▶ ai (${model}): ${oneLine(step.prompt, 100)}\n`)
    await rt.sandbox.ensureUp()

    const dir = await mkdtemp(join(tmpdir(), 'knecht-ai-'))
    try {
      await writeAgentConfig(rt, step.system ?? '', bareModel)

      if (!step.output) {
        const text = await runOpencode(rt, dir, model, env, step.prompt, hasConversation(rt))
        const json = tryParseJson(stripFences(text))
        return json === undefined ? { text } : { text, json }
      }
      return await runWithOutput(rt, dir, model, env, step.prompt, step.output)
    }
    finally {
      await persistAgentMemory(rt.project.id, rt.checkoutDir, rt.log)
      await rm(dir, { recursive: true, force: true })
    }
  },
})

function hasConversation(rt: ActionRuntime): boolean {
  return existsSync(join(rt.checkoutDir, '.knecht', 'data'))
}

async function resolveAgentEnv(
  sessionId: number,
  stepModel?: string,
): Promise<{ model: string, bareModel: string, env: Record<string, string> }> {
  const settings = getSettings()
  if (!settings.aiKeyEnc) {
    throw new Error('AI provider API key not configured, add it under Settings → Agent')
  }
  const configured = stepModel?.trim() || settings.aiModel
  if (!configured) {
    throw new Error('No default model configured (a provider switch clears it), pick one under Settings → Agent')
  }
  const bare = stripLegacyModelPrefix(configured)
  if (!MODEL_NAME_RE.test(bare)) {
    throw new Error(`Invalid model '${bare}': expected a bare model name, e.g. claude-sonnet-4-5`)
  }
  const provider = settings.aiProvider as AiProviderId
  const envNames = PROVIDER_KEY_ENV[provider]
  if (!envNames) {
    throw new Error(`Unsupported provider '${provider}'. Supported: ${Object.keys(PROVIDER_KEY_ENV).join(', ')}`)
  }
  const model = agentModelRef(provider, bare)
  if (!MODEL_RE.test(model)) {
    throw new Error(`Invalid model '${model}': not shell-safe`)
  }
  const key = decrypt(settings.aiKeyEnc)
  return {
    model,
    bareModel: bare,
    env: { ...Object.fromEntries(envNames.map(name => [name, key])), ...await bridgeEnv(sessionId) },
  }
}

export async function runFollowupPrompt(rt: ActionRuntime, prompt: string): Promise<string> {
  const { model, bareModel, env } = await resolveAgentEnv(rt.sessionId)
  rt.log(`\n▶ follow-up (${model}): ${oneLine(prompt, 100)}\n`)
  await rt.sandbox.ensureUp()
  await writeAgentConfig(rt, null, bareModel)
  const dir = await mkdtemp(join(tmpdir(), 'knecht-ai-'))
  try {
    return await runOpencode(rt, dir, model, env, prompt, true)
  }
  finally {
    await persistAgentMemory(rt.project.id, rt.checkoutDir, rt.log)
    await rm(dir, { recursive: true, force: true })
  }
}

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
  const continueFirst = hasConversation(rt)
  for (let attempt = 1; attempt <= MAX_OUTPUT_ATTEMPTS; attempt++) {
    const text = await runOpencode(rt, dir, model, env, message, attempt > 1 || continueFirst)
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

// The prompt travels as a file: no shell quoting of user text.
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
  // Unique per invocation: a retry or follow-up must not race an earlier prompt file.
  const inSandbox = `/tmp/knecht-ai-${rt.runId}-${Date.now()}.txt`
  await rt.sandbox.copyIn(hostFile, inSandbox)
  // Without --auto, tool permissions are rejected and the run stalls.
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

async function writeAgentConfig(rt: ActionRuntime, system: string | null, bareModel: string): Promise<void> {
  const settings = getSettings()
  const dir = join(rt.checkoutDir, AGENT_CONFIG_SUBDIR)
  await mkdir(dir, { recursive: true })
  const agents = await readSandboxAsset('opencode/AGENTS.md')
  if (agents) await writeFile(join(dir, 'AGENTS.md'), agents)
  // Always written, empty when unset, so the static path in the generated config resolves.
  await writeFile(join(dir, 'rules.md'), buildAgentRules(settings.agentInstructions, rt.project.agentInstructions))
  await writeFile(join(dir, 'opencode.json'), JSON.stringify(buildOpencodeConfig({
    provider: settings.aiProvider as AiProviderId,
    region: settings.aiRegion,
    model: bareModel,
    subtaskModel: settings.aiSubtaskModel,
  }), null, 2))
  if (system !== null) await writeFile(join(dir, 'workflow.md'), system)
  else if (!existsSync(join(dir, 'workflow.md'))) await writeFile(join(dir, 'workflow.md'), '')
  await seedAgentMemory(rt.project.id, rt.checkoutDir)
}

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
