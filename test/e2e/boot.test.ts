import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { previewLabel } from '../../shared/utils/preview-host'
import type { E2eClient, PreviewResponse } from './client'
import { expectJson, login, previewFetch } from './client'

interface BootFixture {
  repo: string
  primaryHost?: string
  extraHosts?: string[]
  envVars?: { key: string, value: string }[]
  bootCommands: string
  devServer?: string
  previewPort?: number
  /** Fetched raw from the fixture repo, so it must be public. */
  seedDbPath?: string
  bootDeadlineMs?: number
}

const DEFAULT_BOOT_DEADLINE_MS = 8 * 60_000

const BOOT_WORKFLOW = `
version: 1
name: e2e-boot
description: Boot a fixture through its project boot commands.
steps:
  - ddev-start
`

const JS_BOOT = 'ddev npm install && ddev npm run build'
const PHP_BOOT = `ddev composer install\n${JS_BOOT}`

const FIXTURES: BootFixture[] = [
  {
    repo: 'knecht-works/test-php',
    primaryHost: 'test-php.ddev.site',
    extraHosts: ['alpha.test-php.ddev.site'],
    bootCommands: PHP_BOOT,
  },
  {
    repo: 'knecht-works/test-craftcms',
    primaryHost: 'test-craftcms.ddev.site',
    extraHosts: ['en.craftcms.ddev.site', 'de.craftcms.ddev.site', 'cp.craftcms.ddev.site'],
    seedDbPath: 'seed/db.sql.gz',
    bootCommands: PHP_BOOT,
    bootDeadlineMs: 12 * 60_000,
    // The security key deliberately does NOT match the seed's: that only
    // invalidates sessions, and proves a fresh key is enough to boot a dump.
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
  {
    repo: 'knecht-works/test-kirby',
    primaryHost: 'test-kirby.ddev.site',
    bootCommands: PHP_BOOT,
    bootDeadlineMs: 12 * 60_000,
  },
  {
    repo: 'knecht-works/test-drupal10',
    primaryHost: 'test-drupal10.ddev.site',
    seedDbPath: 'seed/db.sql.gz',
    bootCommands: `ddev composer install && ddev drush cr\n${JS_BOOT}`,
    bootDeadlineMs: 12 * 60_000,
  },
  {
    repo: 'knecht-works/test-drupal11',
    primaryHost: 'test-drupal11.ddev.site',
    seedDbPath: 'seed/db.sql.gz',
    bootCommands: `ddev composer install && ddev drush cr\n${JS_BOOT}`,
    bootDeadlineMs: 12 * 60_000,
  },
  {
    repo: 'knecht-works/test-laravel',
    primaryHost: 'test-laravel.ddev.site',
    bootCommands: `ddev composer install\nddev artisan migrate --force\n${JS_BOOT}`,
    bootDeadlineMs: 12 * 60_000,
    // APP_KEY must decode to exactly 32 bytes: AES-256-CBC rejects any other length
    // on the first web request, after a clean boot.
    envVars: envList({
      APP_NAME: 'test-laravel',
      APP_ENV: 'local',
      APP_KEY: 'base64:a25lY2h0LWUyZS1sYXJhdmVsLWFwcC1rZXktMDEyMzQ=',
      APP_DEBUG: 'true',
      APP_URL: 'https://test-laravel.ddev.site',
      DB_CONNECTION: 'mysql',
      DB_HOST: 'db',
      DB_PORT: '3306',
      DB_DATABASE: 'db',
      DB_USERNAME: 'db',
      DB_PASSWORD: 'db',
      SESSION_DRIVER: 'database',
      CACHE_STORE: 'database',
      QUEUE_CONNECTION: 'database',
    }),
  },
  {
    repo: 'knecht-works/test-typo3',
    primaryHost: 'test-typo3.ddev.site',
    seedDbPath: 'seed/db.sql.gz',
    bootCommands: PHP_BOOT,
    bootDeadlineMs: 12 * 60_000,
  },
  {
    repo: 'knecht-works/test-no-ddev',
    bootCommands: 'pnpm install',
    devServer: 'pnpm dev',
    previewPort: 3000,
  },
]

const only = process.env.KNECHT_E2E_FIXTURE
const selected = only
  ? FIXTURES.filter(f => f.repo === only || f.repo.endsWith(`/${only}`))
  : FIXTURES
if (!selected.length) {
  throw new Error(`KNECHT_E2E_FIXTURE=${only} matches none of: ${FIXTURES.map(f => f.repo).join(', ')}`)
}

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

function previewFailure(origin: string, res: PreviewResponse): string {
  return `${origin} answered ${res.status}:\n${res.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500)}`
}

async function cleanup(client: E2eClient, path: string): Promise<void> {
  const res = await client.fetch(path, { method: 'DELETE' })
  if (!res.ok) console.warn(`Cleanup DELETE ${path} failed: ${res.status} ${await res.text()}`)
}

for (const fixture of selected) {
  const deadlineMs = fixture.bootDeadlineMs ?? DEFAULT_BOOT_DEADLINE_MS

  describe(`boot of ${fixture.repo}`, () => {
    let client: E2eClient
    let projectId: number | undefined
    let ownProject = false
    let workflowId: number | undefined
    let runId: number | undefined

    beforeAll(async () => {
      client = await login()
    })

    afterAll(async () => {
      if (runId) await cleanup(client, `/api/runs/${runId}`)
      if (projectId && ownProject) await cleanup(client, `/api/projects/${projectId}`)
      if (workflowId) await cleanup(client, `/api/workflows/${workflowId}`)
    })

    it('boots the fixture and serves every preview origin', { timeout: deadlineMs + 3 * 60_000 }, async () => {
      const connected = await connectFixture(client, fixture.repo)
      projectId = connected.projectId
      ownProject = connected.own

      if (ownProject) {
        const { envVars, bootCommands, devServer, previewPort } = fixture
        const patched = await client.fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ envVars, bootCommands, devServer, previewPort }),
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

      const imported = await expectJson<{ id: number }>(await client.fetch('/api/workflows/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: BOOT_WORKFLOW }),
      }))
      workflowId = imported.id

      const run = await expectJson<RunRow>(await client.fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, workflowId }),
      }))
      runId = run.id

      const finished = await pollUntilFinished(client, run.id, deadlineMs)
      if (finished.status !== 'success') {
        throw new Error(`Run ${run.id} finished '${finished.status}'. Log:\n${(finished.log ?? '').slice(-4000)}`)
      }
      expect(finished.envState).toBe('up')
      if (fixture.primaryHost) expect(finished.previewHosts).toContain(fixture.primaryHost)
      else expect(finished.previewHosts).toEqual([])
      for (const host of fixture.extraHosts ?? []) {
        expect(finished.previewHosts).toContain(host)
      }

      const primary = await previewFetch(run.id, { cookie: client.cookie })
      expect(primary.status, previewFailure('primary origin', primary)).toBe(200)
      expect(primary.body.length).toBeGreaterThan(0)

      // Not pinned to 200: a CMS may answer a host with a redirect (CP host to login).
      for (const host of fixture.extraHosts ?? []) {
        const labelled = await previewFetch(run.id, { label: previewLabel(host), cookie: client.cookie })
        expect(labelled.status, previewFailure(`preview origin for ${host}`, labelled)).toBeLessThan(400)
      }

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
