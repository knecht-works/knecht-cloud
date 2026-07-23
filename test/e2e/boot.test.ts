import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { previewLabel } from '../../shared/utils/preview-host'
import type { E2eClient } from './client'
import { expectJson, login, previewFetch } from './client'

// The boot e2e: connect a real fixture repo per supported CMS, run
// boot-and-preview as a real ddev project and check the preview origins it
// serves. Talks HTTP only; the substrate (Docker, the ddev CLI) lives on the
// instance side, so the same test runs against the CI dev server and the dev
// VM.
//
// One FIXTURES entry per CMS: the whole scenario below (connect, configure,
// boot, probe previews, tear down) runs identically for each, so supporting a
// new CMS means adding one entry, not another test. Fixtures that cannot
// boot from a bare clone (a CMS needs env config and an installed database)
// declare envVars and a demo dump the fixture repo ships (seedDbPath): the
// test then walks the same path a user does in the product, set the
// project's env vars, upload the dump, boot.
//
// The instance needs GitHub App credentials with the app installed on every
// fixture repo. CI provides them via KNECHT_TEST_GITHUB_APP_ID and
// KNECHT_TEST_GITHUB_APP_PRIVATE_KEY (the dev-only read fallback in
// server/utils/github-credentials.ts).

interface BootFixture {
  /** GitHub repo (owner/name) the instance's GitHub App is installed on. */
  repo: string
  /** The ddev primary host (its .ddev/config.yaml `name` + tld). */
  primaryHost: string
  /** Additional ddev hostnames; each gets its own labelled preview origin. */
  extraHosts?: string[]
  /** Project env vars, applied only to a project THIS test created (an
   * instance that already has the project, e.g. the dev VM, keeps its own
   * config). */
  envVars?: { key: string, value: string }[]
  /** Repo path of a demo DB dump, uploaded as the project dump before the
   * boot (fetched raw from the fixture repo, so it must be public). */
  seedDbPath?: string
  /** Boot deadline override for slow stacks (composer install, asset builds). */
  bootDeadlineMs?: number
}

const DEFAULT_BOOT_DEADLINE_MS = 8 * 60_000

const FIXTURES: BootFixture[] = [
  {
    repo: 'knecht-works/test-php',
    primaryHost: 'test-php.ddev.site',
    extraHosts: ['alpha.test-php.ddev.site'],
  },
  {
    repo: 'knecht-works/test-craftcms',
    primaryHost: 'test-craftcms.ddev.site',
    extraHosts: ['en.craftcms.ddev.site', 'de.craftcms.ddev.site', 'cp.craftcms.ddev.site'],
    seedDbPath: 'seed/db.sql.gz',
    // Composer install + vite build make this boot slower than plain php.
    bootDeadlineMs: 12 * 60_000,
    // The security key is a throwaway that does NOT match the one the seed
    // was created with: that only invalidates sessions/tokens, rendering
    // still works, and it proves a fresh key is enough to boot a dumped site.
    envVars: envList({
      CRAFT_ENVIRONMENT: 'dev',
      CRAFT_APP_ID: 'CraftKnechtE2E',
      CRAFT_SECURITY_KEY: 'knecht-e2e-security-key-0123456789',
      CRAFT_DEV_MODE: 'true',
      CRAFT_WEB_ROOT: '/var/www/html/web',
      CRAFT_DB_DRIVER: 'mysql',
      CRAFT_DB_SERVER: 'db',
      CRAFT_DB_PORT: '3306',
      CRAFT_DB_DATABASE: 'db',
      CRAFT_DB_USER: 'db',
      CRAFT_DB_PASSWORD: 'db',
      CRAFT_BASE_CP_URL: 'https://cp.craftcms.ddev.site',
      PRIMARY_SITE_URL: 'https://en.craftcms.ddev.site',
      PRIMARY_SITE_URL_DE: 'https://de.craftcms.ddev.site',
    }),
  },
]

function envList(vars: Record<string, string>): { key: string, value: string }[] {
  return Object.entries(vars).map(([key, value]) => ({ key, value }))
}

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
async function pollUntilFinished(client: E2eClient, runId: number, deadlineMs: number): Promise<RunRow> {
  const deadline = Date.now() + deadlineMs
  while (true) {
    const runs = await expectJson<Pick<RunRow, 'id' | 'status'>[]>(await client.fetch('/api/runs'))
    const status = runs.find(r => r.id === runId)?.status
    if (!status) throw new Error(`Run ${runId} disappeared from the run list`)
    if (status !== 'queued' && status !== 'running') {
      return await expectJson<RunRow>(await client.fetch(`/api/runs/${runId}`))
    }
    if (Date.now() > deadline) {
      const run = await expectJson<RunRow>(await client.fetch(`/api/runs/${runId}`))
      throw new Error(`Run ${runId} still ${run.status} after ${deadlineMs / 60_000}min. Log:\n${(run.log ?? '').slice(-4000)}`)
    }
    await new Promise(r => setTimeout(r, 5000))
  }
}

// Connect a fixture repo as a project, or adopt the instance's existing
// project for it. `own` says whether THIS test created it: only then is it
// configured (env/dump) and deleted afterwards; an instance that already had
// the fixture (the dev VM) keeps its project, config and run history.
async function connectFixture(client: E2eClient, fullName: string): Promise<{ projectId: number, own: boolean, defaultBranch: string }> {
  const repos = await expectJson<RepoData[]>(await client.fetch('/api/github/repos'))
  const repo = repos.find(r => r.fullName === fullName)
  if (!repo) {
    throw new Error(`The instance's GitHub App is not installed on ${fullName}; install it on the fixture repo.`)
  }

  const { githubId, owner, name, defaultBranch, cloneUrl } = repo
  const created = await client.fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ githubId, owner, name, fullName, defaultBranch, cloneUrl, private: repo.private }),
  })
  if (created.status === 409) {
    const projects = await expectJson<{ id: number, fullName: string }[]>(await client.fetch('/api/projects'))
    const existing = projects.find(p => p.fullName === fullName)?.id
    if (!existing) throw new Error(`Project create for ${fullName} conflicted but the project is not listed`)
    return { projectId: existing, own: false, defaultBranch }
  }
  return { projectId: (await expectJson<{ id: number }>(created)).id, own: true, defaultBranch }
}

// Best-effort teardown, but never silent: a failed DELETE on a persistent
// instance (the dev VM) would otherwise leak the sandbox or project unnoticed.
async function cleanup(client: E2eClient, path: string): Promise<void> {
  const res = await client.fetch(path, { method: 'DELETE' })
  if (!res.ok) console.warn(`Cleanup DELETE ${path} failed: ${res.status} ${await res.text()}`)
}

for (const fixture of FIXTURES) {
  const deadlineMs = fixture.bootDeadlineMs ?? DEFAULT_BOOT_DEADLINE_MS

  describe(`boot-and-preview on ${fixture.repo}`, () => {
    let client: E2eClient
    let projectId: number | undefined
    let ownProject = false
    let runId: number | undefined

    beforeAll(async () => {
      client = await login()
    })

    afterAll(async () => {
      if (runId) await cleanup(client, `/api/runs/${runId}`)
      if (projectId && ownProject) await cleanup(client, `/api/projects/${projectId}`)
    })

    it('boots the fixture and serves every preview origin', { timeout: deadlineMs + 3 * 60_000 }, async () => {
      const connected = await connectFixture(client, fixture.repo)
      projectId = connected.projectId
      ownProject = connected.own

      if (ownProject && fixture.envVars) {
        const patched = await client.fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ envVars: fixture.envVars }),
        })
        expect(patched.ok).toBe(true)
      }

      if (ownProject && fixture.seedDbPath) {
        const seedUrl = `https://raw.githubusercontent.com/${fixture.repo}/${connected.defaultBranch}/${fixture.seedDbPath}`
        const seed = await fetch(seedUrl)
        if (!seed.ok) throw new Error(`Fetching the fixture seed at ${seedUrl} failed: ${seed.status}`)
        const form = new FormData()
        form.append('file', new Blob([await seed.arrayBuffer()], { type: 'application/gzip' }), 'seed.sql.gz')
        const uploaded = await client.fetch(`/api/projects/${projectId}/dump`, { method: 'POST', body: form })
        expect(uploaded.ok).toBe(true)
      }

      const run = await expectJson<RunRow>(await client.fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, workflow: 'boot-and-preview' }),
      }))
      runId = run.id

      const finished = await pollUntilFinished(client, run.id, deadlineMs)
      if (finished.status !== 'success') {
        throw new Error(`Run ${run.id} finished '${finished.status}'. Log:\n${(finished.log ?? '').slice(-4000)}`)
      }
      expect(finished.envState).toBe('up')
      expect(finished.previewHosts).toContain(fixture.primaryHost)
      for (const host of fixture.extraHosts ?? []) {
        expect(finished.previewHosts).toContain(host)
      }

      // The primary origin serves the booted project to a logged-in visitor.
      const primary = await previewFetch(run.id, { cookie: client.cookie })
      expect(primary.status).toBe(200)
      expect(primary.body.length).toBeGreaterThan(0)

      // Every additional hostname gets its own labelled origin. Not pinned to
      // 200: a CMS may legitimately answer a host with a redirect (a CP host
      // to its login page), only server errors fail.
      for (const host of fixture.extraHosts ?? []) {
        const labelled = await previewFetch(run.id, { label: previewLabel(host), cookie: client.cookie })
        expect(labelled.status, `preview origin for ${host}`).toBeLessThan(400)
      }

      // Previews are login-gated: a logged-out navigation is redirected to
      // the dashboard login, a logged-out subresource request gets a plain 401.
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
}
