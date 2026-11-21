import { z } from 'zod'
import { logSink, notice, openAgent, type AgentSession, type TranscriptSink } from '#server/daemon/agent'
import { type AiOutputField, type AiOutputType, parseAiOutputSpec } from '#shared/utils/workflow'
import { AI_PROVIDERS, type AiProviderId, MODEL_NAME_RE, aiProviderSpec, stripLegacyModelPrefix } from '#shared/utils/ai'
import { getSettings } from '#server/utils/settings'
import { type AiConnection, resolveAiConnection } from '#server/utils/ai-connection'
import { decrypt } from '#server/utils/crypto'
import { tryParseJson } from '#server/utils/json'
import { bridgeEnv } from '#server/utils/knecht-env'
import { agentMemoryFiles, installAgentFiles, persistAgentMemory } from '#server/utils/agent-memory'
import { AGENT_KEY_ENV, agentModelRef, buildAgentRules, buildOpencodeConfig } from '#server/utils/opencode-config'
import { readSandboxAsset } from '#server/utils/sandbox-assets'
import { prepareMcp } from '#server/utils/mcp'
import { AGENT_BROWSER_CONFIG_FILE, agentBrowserConfig, agentBrowserMcp } from '#server/utils/agent-browser'
import { AGENT_BROWSER_MCP } from '#shared/utils/mcp'
import { sessionPreviewUrl } from '#server/utils/preview-target'
import { defineAction, ActionError } from '#server/workflows/actions/types'
import type { ActionRuntime } from '#server/workflows/actions/types'
import { getSessionRow, updateSession } from '#server/stores/sessions'
import { getRun } from '#server/stores/runs'
import { getIntegration } from '#server/integrations'
import { freshTicketSince, ticketFetched } from '#server/utils/object-freshness'
import { snapshotDir, writeObjectSnapshot } from '#server/utils/object-snapshot'
import { describeObject, primaryObject, taskBriefing } from '#server/utils/sessions'

const MAX_OUTPUT_ATTEMPTS = 3

export const aiAction = defineAction({
  type: 'ai',
  params: {
    prompt: z.string().min(1),
    model: z.string().optional(),
    output: z.string().optional().refine(
      v => v === undefined || isValidOutputSpec(v),
      { message: 'output must be lines of `name: type` (types: string, number, boolean, or their [] arrays)' },
    ),
    freshContext: z.boolean().optional(),
  },
  async run(step, rt) {
    const { model, bareModel, env, connection } = await resolveAgentEnv(rt, step.model)
    rt.log(`\n▶ ai (${model}): ${oneLine(step.prompt, 100)}\n`)
    await rt.sandbox.ensureUp()
    const sink = logSink(rt.log)
    const mcpEnv = await writeAgentConfig(rt, bareModel, connection, sink)

    const fresh = !!step.freshContext
    const session = getSessionRow(rt.sessionId)
    const handover = fresh ? null : session?.agentHandover
    const notes = fresh ? null : session?.agentNotes
    const run = getRun(rt.runId)
    const briefing = taskBriefing(rt.sessionId, run?.objectId, run?.actor?.name)
    const prompt = `${handover ? handoverPreamble(handover) : ''}${notes ? notesPreamble(notes) : ''}${briefing}${await refreshTicket(rt)}${step.prompt}`
    const agent = fresh
      ? await startAgent(rt, { ...env, ...mcpEnv }, null, sink, model)
      : await startSessionAgent(rt, { ...env, ...mcpEnv }, sink, model)
    try {
      const result = step.output ? await runWithOutput(rt, agent, prompt, step.output) : await promptText(agent, prompt)
      if (fresh) addAgentNote(rt.sessionId, `The workflow "${run?.workflow}" (run #${rt.runId}) worked in this session in a conversation of its own. Its final message:\n\n${result.text}`)
      return result
    }
    finally {
      if (handover) updateSession(rt.sessionId, { agentHandover: null })
      if (notes) updateSession(rt.sessionId, { agentNotes: null })
      await agent.close()
      await persistAgentMemory(rt.project.id, rt.sandbox, memoryLog(rt))
    }
  },
})

async function promptText(agent: AgentSession, prompt: string): Promise<{ text: string, json?: unknown }> {
  const { text } = await agent.prompt(prompt)
  if (!text) throw new Error('the agent produced no output')
  const json = tryParseJson(stripFences(text))
  return json === undefined ? { text } : { text, json }
}

function addAgentNote(sessionId: number, note: string): void {
  const current = getSessionRow(sessionId)?.agentNotes
  updateSession(sessionId, { agentNotes: current ? `${current}\n\n---\n\n${note}` : note })
}

export function notesPreamble(notes: string): string {
  return `Since your last turn, other work happened in this session:\n\n${notes}\n\n---\n\n`
}

// With a cold cache opencode only knows the models bundled into its binary, so a newer model is "not found" and the turn runs on its default.
const WARM_MODEL_CACHE = 'test -s "$HOME/.cache/opencode/models.json" || opencode models --refresh >/dev/null 2>&1 || true'

async function startAgent(rt: ActionRuntime, env: Record<string, string>, sessionId: string | null, sink: TranscriptSink, model?: string): Promise<AgentSession> {
  await rt.sandbox.exec(['sh', '-c', WARM_MODEL_CACHE])
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
  rt: ActionRuntime,
  stepModel?: string | null,
): Promise<{ model: string, bareModel: string, env: Record<string, string>, connection: AiConnection }> {
  const { connection, model: configured } = await resolveAiConnection(rt.project.id, stepModel)
  if (!connection.aiKeyEnc) {
    throw new Error('AI provider API key not configured, add it under Settings → Agent')
  }
  if (!configured) {
    throw new Error('No default model configured (a provider switch clears it), pick one under Settings → Agent')
  }
  const bare = stripLegacyModelPrefix(configured)
  if (!MODEL_NAME_RE.test(bare)) {
    throw new Error(`Invalid model '${bare}': expected a bare model name, e.g. claude-sonnet-4-5`)
  }
  const provider = connection.aiProvider as AiProviderId
  if (!aiProviderSpec(provider)) {
    throw new Error(`Unsupported provider '${provider}'. Supported: ${AI_PROVIDERS.map(p => p.id).join(', ')}`)
  }
  const model = agentModelRef(provider, bare)
  const key = decrypt(connection.aiKeyEnc)
  return {
    model,
    bareModel: bare,
    env: { [AGENT_KEY_ENV]: key, ...await bridgeEnv(rt.sessionId) },
    connection,
  }
}

export async function runFollowupPrompt(rt: ActionRuntime, prompt: string, sink: TranscriptSink, model?: string | null): Promise<string> {
  const { model: modelRef, bareModel, env, connection } = await resolveAgentEnv(rt, model)
  await rt.sandbox.ensureUp()
  const mcpEnv = await writeAgentConfig(rt, bareModel, connection, sink)
  const ticket = await refreshTicket(rt)
  const agent = await startSessionAgent(rt, { ...env, ...mcpEnv }, sink, modelRef)
  try {
    const { text } = await agent.prompt(`${ticket}${prompt}`)
    if (!text) throw new Error('the agent produced no output')
    return text
  }
  finally {
    await agent.close()
    await persistAgentMemory(rt.project.id, rt.sandbox, memoryLog(rt))
  }
}

// A cancel also cancels the copy-back, and its error says nothing the user can act on.
function memoryLog(rt: ActionRuntime): (text: string) => void {
  return (text) => {
    if (!rt.signal.aborted) rt.log(text)
  }
}

const HANDOVER_PROMPT = 'This conversation is being handed over to a fresh session that knows nothing about it. Write the hand-over as plain markdown: the goal, what you did and where in the repository, the current state of the working tree and branch, open points and anything the next session must not repeat. No preamble, no questions.'

const SILENT_SINK: TranscriptSink = { item() {}, end() {} }

// The summary is never shown: it is stored on the session and opens the next turn's fresh agent session.
export async function compactAgentSession(rt: ActionRuntime, sink: TranscriptSink, model?: string | null): Promise<string> {
  const { bareModel, env, connection } = await resolveAgentEnv(rt, model)
  await rt.sandbox.ensureUp()
  const mcpEnv = await writeAgentConfig(rt, bareModel, connection, SILENT_SINK)
  const current = getSessionRow(rt.sessionId)?.agentSessionId ?? null
  let summary = ''
  if (current) {
    const agent = await startAgent(rt, { ...env, ...mcpEnv }, current, SILENT_SINK)
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
  const object = primaryObject(rt.sessionId)
  if (!object) return ''
  const integration = getIntegration(object.integration)
  const dir = snapshotDir(object.key)
  // Read up front, the rules slip by the end of a task: a "fix it and open a PR" left the status as it was.
  const hasRules = !!(getSettings().agentInstructions.trim() || rt.project.agentInstructions.trim())
  const finish = hasRules ? ` Before your last reply, do what .knecht/opencode/rules.md asks for the ${describeObject(object)} at this point, such as moving its status.` : ''
  const since = freshTicketSince(rt.sessionId, integration)
  if (since && await rt.sandbox.exec(['sh', '-c', 'test -f "$1" && echo yes || true', 'sh', `${dir}/ticket.md`]).then(out => out.trim() === 'yes')) {
    return `The ${describeObject(object)} is current in ${dir}/ticket.md (fetched ${since.toISOString()}, unchanged since).${finish}\n\n`
  }
  try {
    const context = await integration.objects.context(rt.project, object)
    const fetchedAt = new Date()
    await writeObjectSnapshot(rt.sandbox, context, fetchedAt)
    ticketFetched(rt.sessionId, fetchedAt)
    return `The ${describeObject(object)} is current in ${dir}/ticket.md (fetched just now).${finish}\n\n`
  }
  catch (e) {
    rt.log(`\nCould not refresh ${describeObject(object)}: ${(e as Error).message}\n`)
    return `Refreshing the ${describeObject(object)} failed, so ${dir}/ may be out of date: run \`knecht-object\` to retry.${finish}\n\n`
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

async function writeAgentConfig(rt: ActionRuntime, bareModel: string, connection: AiConnection, sink: TranscriptSink): Promise<Record<string, string>> {
  const settings = getSettings()
  const mcp = await prepareMcp(rt.project.id)
  for (const text of mcp.notices) sink.item(notice(text))
  const files: Record<string, string | Uint8Array> = {}
  const session = getSessionRow(rt.sessionId)
  if (session && sessionPreviewUrl(session)) {
    mcp.servers[AGENT_BROWSER_MCP] = agentBrowserMcp()
    files[AGENT_BROWSER_CONFIG_FILE] = agentBrowserConfig(rt.sessionId)
  }
  const agents = await readSandboxAsset('opencode/AGENTS.md')
  if (agents) files['AGENTS.md'] = agents
  // Always written, empty when unset, so the static path in the generated config resolves.
  files['rules.md'] = buildAgentRules(settings.agentInstructions, rt.project.agentInstructions)
  files['opencode.json'] = JSON.stringify(buildOpencodeConfig({
    provider: connection.aiProvider as AiProviderId,
    region: connection.aiRegion,
    model: bareModel,
    subtaskModel: connection.aiSubtaskModel,
    mcp: mcp.servers,
  }), null, 2)
  for (const [name, text] of Object.entries(await agentMemoryFiles(rt.project.id))) files[`memory/${name}`] = text
  await installAgentFiles(rt.sandbox, files)
  return mcp.env
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
