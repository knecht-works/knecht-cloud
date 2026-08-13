import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { expectJson, login, type E2eClient } from './client'

// The draft/publish lifecycle through the real HTTP API: create a shell,
// autosave a loose draft, publish after strict validation, discard, rename.
// Workflows created here are timestamp-named and deleted afterwards, so the
// suite can run against a dev instance with real data.

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
  })

  it('autosaves an incomplete draft, which cannot publish or run', async () => {
    const wf = await createWorkflow({ name: `e2e-draft-${Date.now()}` })

    // A half-filled step saves fine and comes back exactly as sent.
    const patched = await patchWorkflow(wf.id, { draftSteps: [{ type: 'bash' }] })
    expect(patched.ok).toBe(true)
    expect((await getWorkflow(wf.id)).draftSteps).toEqual([{ type: 'bash' }])

    // Publish is the strict gate: the incomplete draft is rejected.
    const publish = await api.fetch(`/api/workflows/${wf.id}/publish`, { method: 'POST' })
    expect(publish.status).toBe(400)

    // Production runs need a published version (checked before the project).
    const run = await api.fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 999999, workflowId: wf.id }),
    })
    expect(run.status).toBe(400)
    expect(await run.text()).toContain('no published version')

    // Export serves the published document, of which there is none yet.
    const exported = await api.fetch(`/api/workflows/${wf.id}/export?format=yaml`)
    expect(exported.status).toBe(400)
  })

  it('publishes a completed draft: steps promoted, draft cleared, export unlocked', async () => {
    const wf = await createWorkflow({ name: `e2e-publish-${Date.now()}` })
    await patchWorkflow(wf.id, { draftSteps: [{ type: 'bash', command: 'echo hi' }] })

    const publish = await api.fetch(`/api/workflows/${wf.id}/publish`, { method: 'POST' })
    expect(publish.ok).toBe(true)

    const row = await getWorkflow(wf.id)
    expect(row.steps).toHaveLength(1)
    expect(row.steps[0]).toMatchObject({ type: 'bash' })
    expect(row.steps[0]!.id).toBeTruthy()
    expect(row.draftSteps).toBeNull()
    expect(row.publishedAt).toBeTruthy()

    const exported = await api.fetch(`/api/workflows/${wf.id}/export?format=yaml`)
    expect(exported.ok).toBe(true)
  })

  it('normalizes a draft equal to the published steps back to null', async () => {
    const wf = await createWorkflow({ name: `e2e-noop-draft-${Date.now()}` })
    await patchWorkflow(wf.id, { draftSteps: [{ type: 'bash', command: 'echo hi' }] })
    await api.fetch(`/api/workflows/${wf.id}/publish`, { method: 'POST' })

    // Re-sending exactly the published steps means "no unpublished changes".
    const published = (await getWorkflow(wf.id)).steps
    await patchWorkflow(wf.id, { draftSteps: published })
    expect((await getWorkflow(wf.id)).draftSteps).toBeNull()
  })

  it('discards a draft without touching the published version', async () => {
    const wf = await createWorkflow({ name: `e2e-discard-${Date.now()}` })
    await patchWorkflow(wf.id, { draftSteps: [{ type: 'bash', command: 'echo hi' }] })
    await api.fetch(`/api/workflows/${wf.id}/publish`, { method: 'POST' })
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
