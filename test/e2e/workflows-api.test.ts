import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { expectJson, login, type E2eClient } from './client'

// Import/export through the real HTTP API of a running instance: the file a
// user downloads from one Knecht must load identically on another. Workflows
// created here are timestamp-named and deleted afterwards, so the suite can
// run against a dev instance with real data.

const name = `e2e-roundtrip-${Date.now()}`
const created: string[] = []
let api: E2eClient

const SOURCE = `
version: 1
name: ${name}
description: E2e import/export roundtrip.
steps:
  - bash:
      command: echo hello
      continue-on-error: true
  - if:
      conditions:
        - left: "{{ steps.bash.exitCode }}"
          op: eq
          right: "0"
      then:
        - http:
            url: https://example.com/ping
      else: []
`

interface WorkflowRow { name: string, description: string, steps: unknown[] }

async function importWorkflow(source: string): Promise<WorkflowRow> {
  const row = await expectJson<WorkflowRow>(await api.fetch('/api/workflows/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  }))
  created.push(row.name)
  return row
}

beforeAll(async () => {
  api = await login()
})

afterAll(async () => {
  for (const wf of created) {
    await api.fetch(`/api/workflows/${encodeURIComponent(wf)}`, { method: 'DELETE' })
  }
})

describe('workflow import/export over the API', () => {
  it('imports YAML, exports it and re-imports identically (with a deduped name)', async () => {
    const first = await importWorkflow(SOURCE)
    expect(first.name).toBe(name)
    expect(first.steps).toHaveLength(2)

    const exported = await api.fetch(`/api/workflows/${encodeURIComponent(name)}/export?format=yaml`)
    expect(exported.ok).toBe(true)
    const doc = await exported.text()
    expect(parse(doc).version).toBe(1)

    // Re-importing the export must not overwrite: the copy gets a -2 name and
    // byte-identical steps.
    const second = await importWorkflow(doc)
    expect(second.name).toBe(`${name}-2`)
    expect(second.steps).toEqual(first.steps)
    expect(second.description).toBe(first.description)
  })

  it('rejects a document from a newer format version', async () => {
    const res = await api.fetch('/api/workflows/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: `version: 99\nname: e2e-too-new\nsteps:\n  - ddev-start\n` }),
    })
    expect(res.status).toBe(400)
  })
})
