import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { previewLabel } from '../../shared/utils/preview-host'
import type { E2eClient } from './client'
import { expectJson, login, previewFetch } from './client'

// The boot e2e: connect the real fixture repo, run boot-and-preview in a real
// Sysbox sandbox and check the preview origins it serves. Talks HTTP only; the
// substrate (Docker, Sysbox, sandbox image) lives on the instance side, so the
// same test runs against the CI dev server and the dev VM.
//
// The instance needs GitHub App credentials with the app installed on the
// fixture repo. CI provides them via KNECHT_TEST_GITHUB_APP_ID and
// KNECHT_TEST_GITHUB_APP_PRIVATE_KEY (the dev-only read fallback in
// server/utils/github-credentials.ts).

const FIXTURE = 'knecht-works/test-php'
// The fixture's ddev hosts (its .ddev/config.yaml: name + additional_hostnames).
const FIXTURE_PRIMARY_HOST = 'test-php.ddev.site'
const FIXTURE_EXTRA_HOST = 'alpha.test-php.ddev.site'
const FIXTURE_EXTRA_LABEL = previewLabel(FIXTURE_EXTRA_HOST)

const BOOT_DEADLINE_MS = 8 * 60_000

interface RepoData {
  githubId: number
  owner: string
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
  cloneUrl: string
}

interface RunRow {
  id: number
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled'
  envState: string
  previewHosts: string[] | null
  log: string | null
}

// Poll the list endpoint (it omits the log blob) and fetch the full run once
// at the end, so a minutes-long boot doesn't re-transfer its growing log
// every five seconds.
async function pollUntilFinished(client: E2eClient, runId: number): Promise<RunRow> {
  const deadline = Date.now() + BOOT_DEADLINE_MS
  while (true) {
    const runs = await expectJson<Pick<RunRow, 'id' | 'status'>[]>(await client.fetch('/api/runs'))
    const status = runs.find(r => r.id === runId)?.status
    if (!status) throw new Error(`Run ${runId} disappeared from the run list`)
    if (status !== 'queued' && status !== 'running') {
      return await expectJson<RunRow>(await client.fetch(`/api/runs/${runId}`))
    }
    if (Date.now() > deadline) {
      const run = await expectJson<RunRow>(await client.fetch(`/api/runs/${runId}`))
      throw new Error(`Run ${runId} still ${run.status} after ${BOOT_DEADLINE_MS / 60_000}min. Log:\n${(run.log ?? '').slice(-4000)}`)
    }
    await new Promise(r => setTimeout(r, 5000))
  }
}

// Best-effort teardown, but never silent: a failed DELETE on a persistent
// instance (the dev VM) would otherwise leak the sandbox or project unnoticed.
async function cleanup(client: E2eClient, path: string): Promise<void> {
  const res = await client.fetch(path, { method: 'DELETE' })
  if (!res.ok) console.warn(`Cleanup DELETE ${path} failed: ${res.status} ${await res.text()}`)
}

describe('boot-and-preview on the php fixture', () => {
  let client: E2eClient
  let projectId: number | undefined
  // Only a project THIS test connected gets deleted afterwards; an instance
  // (the dev VM) that already had the fixture keeps it and its run history.
  let ownProject = false
  let runId: number | undefined

  beforeAll(async () => {
    client = await login()
  })

  afterAll(async () => {
    if (runId) await cleanup(client, `/api/runs/${runId}`)
    if (projectId && ownProject) await cleanup(client, `/api/projects/${projectId}`)
  })

  it('boots the fixture and serves every preview origin', async () => {
    const repos = await expectJson<RepoData[]>(await client.fetch('/api/github/repos'))
    const repo = repos.find(r => r.fullName === FIXTURE)
    if (!repo) {
      throw new Error(`The instance's GitHub App is not installed on ${FIXTURE}; install it on the fixture repo.`)
    }

    const { githubId, owner, name, fullName, defaultBranch, cloneUrl } = repo
    const created = await client.fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ githubId, owner, name, fullName, defaultBranch, cloneUrl, private: repo.private }),
    })
    if (created.status === 409) {
      const projects = await expectJson<{ id: number, fullName: string }[]>(await client.fetch('/api/projects'))
      projectId = projects.find(p => p.fullName === FIXTURE)?.id
    }
    else {
      projectId = (await expectJson<{ id: number }>(created)).id
      ownProject = true
    }
    expect(projectId).toBeDefined()

    const run = await expectJson<RunRow>(await client.fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, workflow: 'boot-and-preview' }),
    }))
    runId = run.id

    const finished = await pollUntilFinished(client, run.id)
    if (finished.status !== 'success') {
      throw new Error(`Run ${run.id} finished '${finished.status}'. Log:\n${(finished.log ?? '').slice(-4000)}`)
    }
    expect(finished.envState).toBe('up')
    expect(finished.previewHosts).toContain(FIXTURE_PRIMARY_HOST)
    expect(finished.previewHosts).toContain(FIXTURE_EXTRA_HOST)

    // The primary origin serves the booted project to a logged-in visitor.
    const primary = await previewFetch(run.id, { cookie: client.cookie })
    expect(primary.status).toBe(200)
    expect(primary.body.length).toBeGreaterThan(0)

    // An additional ddev hostname gets its own labelled origin.
    const labelled = await previewFetch(run.id, { label: FIXTURE_EXTRA_LABEL, cookie: client.cookie })
    expect(labelled.status).toBe(200)

    // Previews are login-gated: a logged-out navigation is redirected to the
    // dashboard login, a logged-out subresource request gets a plain 401.
    const anonNav = await previewFetch(run.id)
    expect(anonNav.status).toBe(302)
    expect(anonNav.location).toContain('/login')
    const anonSub = await previewFetch(run.id, { accept: '*/*' })
    expect(anonSub.status).toBe(401)
  })

  it('tears the environment down when the run is deleted', async () => {
    expect(runId).toBeDefined()
    await expectJson(await client.fetch(`/api/runs/${runId}`, { method: 'DELETE' }))

    const gone = await client.fetch(`/api/runs/${runId}`)
    expect(gone.status).toBe(404)
    const preview = await previewFetch(runId!, { cookie: client.cookie })
    expect(preview.status).toBe(404)
    runId = undefined
  })
})
