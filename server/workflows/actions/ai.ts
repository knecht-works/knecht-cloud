import { z } from 'zod'
import { logSink, openAgent, type AgentSession, type TranscriptSink } from '../../daemon/agent'
import { type AiOutputField, type AiOutputType, parseAiOutputSpec } from '../../../shared/utils/workflow'
import { AI_PROVIDERS, type AiProviderId, MODEL_NAME_RE, aiProviderSpec, stripLegacyModelPrefix } from '../../../shared/utils/ai'
import { getSettings } from '../../utils/settings'
import { decrypt } from '../../utils/crypto'
import { tryParseJson } from '../../utils/json'
import { bridgeEnv } from '../../utils/knecht-env'
import { agentMemoryFiles, installAgentFiles, persistAgentMemory } from '../../utils/agent-memory'
import { AGENT_KEY_ENV, agentModelRef, buildAgentRules, buildOpencodeConfig } from '../../utils/opencode-config'
import { readSandboxAsset } from '../../utils/sandbox-assets'
import { defineAction, ActionError } from './types'
import type { ActionRuntime } from './types'
import { getSessionRow, updateSession } from '../../stores/sessions'
import { getIntegration } from '../../integrations'
import { freshTicketSince, ticketFetched } from '../../utils/object-freshness'
import { snapshotDir, writeObjectSnapshot } from '../../utils/object-snapshot'
import { describeObject, sessionObject } from '../../utils/sessions'

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
    await writeAgentConfig(rt, step.system ?? '', bareModel)

    const handover = getSessionRow(rt.sessionId)?.agentHandover
    const prompt = `${handover ? handoverPreamble(handover) : ''}${await refreshTicket(rt)}${step.prompt}`
    const agent = await startSessionAgent(rt, env, logSink(rt.log), model)
    try {
      if (!step.output) {
        const { text } = await agent.prompt(prompt)
        if (!text) throw new Error('the agent produced no output')
        const json = tryParseJson(stripFences(text))
        return json === undefined ? { text } : { text, json }
      }
      return await runWithOutput(rt, agent, prompt, step.output)
    }
    finally {
      if (handover) updateSession(rt.sessionId, { agentHandover: null })
      await agent.close()
      await persistAgentMemory(rt.project.id, rt.sandbox, rt.log)
    }
  },
})

function startAgent(rt: ActionRuntime, env: Record<string, string>, sessionId: string | null, sink: TranscriptSink, model?: string): Promise<AgentSession> {
  return openAgent({
    process: rt.sandbox.spawn(['opencode', 'acp'], { env }),
    cwd: rt.sandbox.projectDir,
    sink,
    signal: rt.signal,
    sessionId,
    model,
  })
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
  if (!aiProviderSpec(provider)) {
    throw new Error(`Unsupported provider '${provider}'. Supported: ${AI_PROVIDERS.map(p => p.id).join(', ')}`)
  }
  const model = agentModelRef(provider, bare)
  const key = decrypt(settings.aiKeyEnc)
  return {
    model,
    bareModel: bare,
    env: { [AGENT_KEY_ENV]: key, ...await bridgeEnv(sessionId) },
  }
}

export async function runFollowupPrompt(rt: ActionRuntime, prompt: string, sink: TranscriptSink, model?: string | null): Promise<string> {
  const { model: modelRef, bareModel, env } = await resolveAgentEnv(rt.sessionId, model ?? undefined)
  await rt.sandbox.ensureUp()
  await writeAgentConfig(rt, null, bareModel)
  const ticket = await refreshTicket(rt)
  const agent = await startSessionAgent(rt, env, sink, modelRef)
  try {
    const { text } = await agent.prompt(`${ticket}${prompt}`)
    if (!text) throw new Error('the agent produced no output')
    return text
  }
  finally {
    await agent.close()
    await persistAgentMemory(rt.project.id, rt.sandbox, rt.log)
  }
}

const HANDOVER_PROMPT = 'This conversation is being handed over to a fresh session that knows nothing about it. Write the hand-over as plain markdown: the goal, what you did and where in the repository, the current state of the working tree and branch, open points and anything the next session must not repeat. No preamble, no questions.'

const SILENT_SINK: TranscriptSink = { item() {}, end() {} }

// The summary is never shown: it is stored on the session and opens the next turn's fresh agent session.
export async function compactAgentSession(rt: ActionRuntime, sink: TranscriptSink, model?: string | null): Promise<string> {
  const { bareModel, env } = await resolveAgentEnv(rt.sessionId, model ?? undefined)
  await rt.sandbox.ensureUp()
  await writeAgentConfig(rt, null, bareModel)
  const current = getSessionRow(rt.sessionId)?.agentSessionId ?? null
  let summary = ''
  if (current) {
    const agent = await startAgent(rt, env, current, SILENT_SINK)
    try {
      if (agent.loaded) summary = (await agent.prompt(HANDOVER_PROMPT)).text.trim()
    }
    finally {
      await agent.close()
    }
  }
  updateSession(rt.sessionId, { agentSessionId: null, agentHandover: summary || null })
  sink.item({ key: 'divider', type: 'divider', text: summary ? 'Context compacted. The next message starts a fresh session with the hand-over.' : 'Context compacted. The next message starts a fresh session.' })
  return summary
}

export function handoverPreamble(summary: string): string {
  return `Hand-over from the previous conversation in this session, read it before acting:\n\n${summary}\n\n---\n\n`
}

// Refreshed before a turn when the ticket changed: in the session's one conversation the agent would otherwise trust an older read.
async function refreshTicket(rt: ActionRuntime): Promise<string> {
  const session = getSessionRow(rt.sessionId)
  const object = session && sessionObject(session)
  if (!object) return ''
  const integration = getIntegration(object.integration)
  const dir = snapshotDir(object.key)
  const since = freshTicketSince(rt.sessionId, integration)
  if (since && await rt.sandbox.exec(['sh', '-c', 'test -f "$1" && echo yes || true', 'sh', `${dir}/ticket.md`]).then(out => out.trim() === 'yes')) {
    return `The ${describeObject(object)} is current in ${dir}/ticket.md (fetched ${since.toISOString()}, unchanged since).\n\n`
  }
  try {
    const context = await integration.objects.context(rt.project, object)
    const fetchedAt = new Date()
    await writeObjectSnapshot(rt.sandbox, context, fetchedAt)
    ticketFetched(rt.sessionId, fetchedAt)
    return `The ${describeObject(object)} is current in ${dir}/ticket.md (fetched just now).\n\n`
  }
  catch (e) {
    rt.log(`\nCould not refresh ${describeObject(object)}: ${(e as Error).message}\n`)
    return `Refreshing the ${describeObject(object)} failed, so ${dir}/ may be out of date: run \`knecht-object\` to retry.\n\n`
  }
}

// Workflow steps and the chat share one agent session per Knecht session, resumed when the agent still has it.
// The config only seeds new sessions; a resumed one is switched to the model explicitly.
async function startSessionAgent(rt: ActionRuntime, env: Record<string, string>, sink: TranscriptSink, model: string): Promise<AgentSession> {
  const agent = await startAgent(rt, env, getSessionRow(rt.sessionId)?.agentSessionId ?? null, sink, model)
  if (!agent.loaded) updateSession(rt.sessionId, { agentSessionId: agent.sessionId })
  return agent
}

async function runWithOutput(
  rt: ActionRuntime,
  agent: AgentSession,
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
    const { text } = await agent.prompt(message)
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
  const files: Record<string, string | Uint8Array> = {}
  const agents = await readSandboxAsset('opencode/AGENTS.md')
  if (agents) files['AGENTS.md'] = agents
  // Always written, empty when unset, so the static path in the generated config resolves.
  files['rules.md'] = buildAgentRules(settings.agentInstructions, rt.project.agentInstructions)
  files['opencode.json'] = JSON.stringify(buildOpencodeConfig({
    provider: settings.aiProvider as AiProviderId,
    region: settings.aiRegion,
    model: bareModel,
    subtaskModel: settings.aiSubtaskModel,
  }), null, 2)
  // A step always (over)writes workflow.md so one ai step's prompt never leaks into a later one.
  if (system !== null) files['workflow.md'] = system
  for (const [name, text] of Object.entries(await agentMemoryFiles(rt.project.id))) files[`memory/${name}`] = text
  await installAgentFiles(rt.sandbox, files)
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

export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
}
