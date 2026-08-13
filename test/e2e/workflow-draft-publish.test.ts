import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectJson, login, type E2eClient } from './client'

// The draft/auto-promote lifecycle through the real HTTP API: create a shell,
// autosave loosely, watch complete saves go live on their own, discard,
// rename, and the automation-enable gate. Workflows created here are
// timestamp-named and deleted afterwards, so the suite can run against a dev
// instance with real data.

interface WorkflowRow {
  id: number
  name: string
  description: string
  steps: { type: string, id?: string }[]
  draftSteps: { type: string }[] | null
  enabled: boolean
  publishedAt: string | number | null
}

let api: E2eClient
const created: number[] = []

async function createWorkflow(body: Record<string, unknown> = {}): Promise<WorkflowRow> {
  const row = await expectJson<WorkflowRow>(await api.fetch('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
  created.push(row.id)
  return row
}

function patchWorkflow(id: number, body: Record<string, unknown>): Promise<Response> {
  return api.fetch(`/api/workflows/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function getWorkflow(id: number): Promise<WorkflowRow> {
  const rows = await expectJson<WorkflowRow[]>(await api.fetch('/api/workflows'))
  const row = rows.find(w => w.id === id)
  if (!row) throw new Error(`Workflow ${id} not in the list`)
  return row
}

beforeAll(async () => {
  api = await login()
})

afterAll(async () => {
  for (const id of created) {
    await api.fetch(`/api/workflows/${id}`, { method: 'DELETE' })
  }
})

describe('workflow draft/publish lifecycle over the API', () => {
  it('creates an untitled shell immediately, uniquifying the default name', async () => {
    const first = await createWorkflow()
    const second = await createWorkflow()
    expect(first.name).toMatch(/^Untitled workflow/)
    expect(second.name).toMatch(/^Untitled workflow/)
    expect(second.name).not.toBe(first.name)
    expect(first.steps).toEqual([])
    expect(first.publishedAt).toBeNull()
    // Automation starts off: turning it on is what publishes the first version.
    expect(first.enabled).toBe(false)
  })

  it('stores an incomplete save as a draft, which cannot run, export or enable automation', async () => {
    const wf = await createWorkflow({ name: `e2e-draft-${Date.now()}` })

    // A half-filled step saves fine, comes back exactly as sent, and does NOT
    // become the live version.
    const patched = await patchWorkflow(wf.id, { draftSteps: [{ type: 'bash' }] })
    expect(patched.ok).toBe(true)
    const row = await getWorkflow(wf.id)
    expect(row.draftSteps).toEqual([{ type: 'bash' }])
    expect(row.steps).toEqual([])
    expect(row.publishedAt).toBeNull()

    // Manual runs execute the current state, validated at start (checked
    // before the project, so a placeholder projectId suffices). The 400 names
    // the missing field.
    const run = await api.fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 999999, workflowId: wf.id }),
    })
    expect(run.status).toBe(400)
    expect(await run.text()).toContain('command')

    // Export serves the current state, which is incomplete too.
    const exported = await api.fetch(`/api/workflows/${wf.id}/export?format=yaml`)
    expect(exported.status).toBe(400)

    // And there is no complete version automation could run.
    const enable = await patchWorkflow(wf.id, { enabled: true })
    expect(enable.status).toBe(400)
  })

  it('promotes a complete save to the live version on its own', async () => {
    const wf = await createWorkflow({ name: `e2e-promote-${Date.now()}` })
    const patched = await patchWorkflow(wf.id, { draftSteps: [{ type: 'bash', command: 'echo hi' }] })
    expect(patched.ok).toBe(true)

    const row = await getWorkflow(wf.id)
    expect(row.steps).toHaveLength(1)
    expect(row.steps[0]).toMatchObject({ type: 'bash' })
    expect(row.steps[0]!.id).toBeTruthy()
    expect(row.draftSteps).toBeNull()
    expect(row.publishedAt).toBeTruthy()

    const exported = await api.fetch(`/api/workflows/${wf.id}/export?format=yaml`)
    expect(exported.ok).toBe(true)

    const enable = await patchWorkflow(wf.id, { enabled: true })
    expect(enable.ok).toBe(true)
  })

  it('keeps the last complete version live while edits are incomplete', async () => {
    const wf = await createWorkflow({ name: `e2e-keep-live-${Date.now()}` })
    await patchWorkflow(wf.id, { draftSteps: [{ type: 'bash', command: 'echo hi' }] })
    const before = await getWorkflow(wf.id)

    await patchWorkflow(wf.id, { draftSteps: [{ type: 'bash', command: 'echo hi' }, { type: 'http' }] })

    const after = await getWorkflow(wf.id)
    expect(after.draftSteps).toHaveLength(2)
    expect(after.steps).toEqual(before.steps)
    expect(after.publishedAt).toEqual(before.publishedAt)
  })

  it('discards incomplete edits back to the last complete version', async () => {
    const wf = await createWorkflow({ name: `e2e-discard-${Date.now()}` })
    await patchWorkflow(wf.id, { draftSteps: [{ type: 'bash', command: 'echo hi' }] })
    await patchWorkflow(wf.id, { draftSteps: [{ type: 'bash', command: 'echo hi' }, { type: 'http' }] })

    const discard = await api.fetch(`/api/workflows/${wf.id}/discard`, { method: 'POST' })
    expect(discard.ok).toBe(true)

    const row = await getWorkflow(wf.id)
    expect(row.draftSteps).toBeNull()
    expect(row.steps).toHaveLength(1)
  })

  it('renames freely but refuses a taken name', async () => {
    const a = await createWorkflow({ name: `e2e-rename-a-${Date.now()}` })
    const b = await createWorkflow({ name: `e2e-rename-b-${Date.now()}` })

    const renamed = await patchWorkflow(a.id, { name: `${a.name}-x` })
    expect(renamed.ok).toBe(true)

    const conflict = await patchWorkflow(a.id, { name: b.name })
    expect(conflict.status).toBe(409)
  })
})
