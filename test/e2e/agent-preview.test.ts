import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { E2eClient } from './client'
import { expectJson, login } from './client'

// The real agent looks at a booted preview through the knecht-browser MCP server. Costs
// tokens, so opt-in: KNECHT_E2E_AGENT=1. KNECHT_E2E_FIXTURE picks another connected project.
const FIXTURE = process.env.KNECHT_E2E_FIXTURE ?? 'knecht-works/test-no-ddev'
const DEADLINE_MS = 15 * 60_000

const PROMPT = `Look at the start page of the running site the way a person sees it in a browser,
then describe what is visible and whether its styles and scripts loaded. List every
stylesheet or script request that failed, as browser_network_requests reports it. Do not change
any project files and do not commit. If you cannot see it, say exactly why.`

const WORKFLOW = `version: 1
name: e2e-agent-browser
description: The agent looks at the preview.
steps:
  - type: ddev-start
  - type: ai
    id: look
    prompt: ${JSON.stringify(PROMPT)}
    output: |
      saw_screenshot: boolean
      styled: boolean
      console_errors: string[]
      failed_assets: string[]
      description: string
      blocker: string
`

interface RunRow {
  id: number
  status: string
}

interface LookOutput {
  saw_screenshot: boolean
  styled: boolean
  console_errors: string[]
  failed_assets: string[]
  description: string
  blocker: string
}

// The log endpoint is an SSE stream whose first `log` event carries the whole log so far.
async function readLog(client: E2eClient, runId: number): Promise<string> {
  const res = await client.fetch(`/api/runs/${runId}/log`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) return ''
    buffer += decoder.decode(value, { stream: true })
    const event = buffer.match(/event: log\ndata: (.*)\n\n/)
    if (event) {
      await reader.cancel()
      return JSON.parse(event[1]!) as string
    }
  }
}

describe.runIf(process.env.KNECHT_E2E_AGENT === '1')(`agent browser on ${FIXTURE}`, () => {
  let client: E2eClient
  let workflowId: number | undefined
  let runId: number | undefined
  let status = ''
  let log = ''
  let output: LookOutput | undefined

  beforeAll(async () => {
    client = await login()
    const projects = await expectJson<{ id: number, fullName: string }[]>(await client.fetch('/api/projects'))
    const project = projects.find(p => p.fullName === FIXTURE || p.fullName.endsWith(`/${FIXTURE}`))
    if (!project) throw new Error(`Connect ${FIXTURE} first, e.g. through the boot e2e with KNECHT_E2E_FIXTURE`)

    workflowId = (await expectJson<{ id: number }>(await client.fetch('/api/workflows/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: WORKFLOW }),
    }))).id
    runId = (await expectJson<RunRow>(await client.fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, workflowId }),
    }))).id

    const deadline = Date.now() + DEADLINE_MS
    while (true) {
      status = (await expectJson<RunRow>(await client.fetch(`/api/runs/${runId}`))).status
      if (status !== 'queued' && status !== 'running') break
      if (Date.now() > deadline) throw new Error(`Run ${runId} still ${status}`)
      await new Promise(r => setTimeout(r, 5000))
    }
    log = await readLog(client, runId)
    const json = log.match(/\{[^{}]*"saw_screenshot"[^{}]*\}/g)?.at(-1)
    output = json ? JSON.parse(json) as LookOutput : undefined
    console.log(`run ${runId} ${status}\n${log.slice(log.indexOf('▶ ai')).slice(-5000)}`)
  }, DEADLINE_MS + 60_000)

  afterAll(async () => {
    if (process.env.KNECHT_E2E_KEEP === '1') return
    if (runId) await client.fetch(`/api/runs/${runId}`, { method: 'DELETE' })
    if (workflowId) await client.fetch(`/api/workflows/${workflowId}`, { method: 'DELETE' })
  })

  it('finishes the run', () => {
    expect(status, log.slice(-3000)).toBe('success')
  })

  it('takes the screenshot with the knecht-browser tools, none failing, without installing a browser', () => {
    expect(log).toMatch(/browser_take_screenshot/)
    expect(log).not.toMatch(/playwright install|apt-get install/)
    expect(log).not.toMatch(/failed tool: knecht-browser/)
  })

  it('sees the rendered, styled page', () => {
    expect(output?.saw_screenshot, output?.blocker).toBe(true)
    expect(output?.styled, output?.description).toBe(true)
    expect(log).toMatch(/browser_network_requests/)
    // Craft's webmcp.js is CORS-blocked for every visitor, not only the agent.
    expect(output?.failed_assets.filter(a => /\.css|app\.js/.test(a))).toEqual([])
  })
})
