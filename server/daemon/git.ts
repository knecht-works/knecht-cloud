import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import type { Project } from '../db/schema'
import { bridgeBaseUrl, bridgeToken } from '../utils/agent-bridge'
import { getBotIdentity } from '../utils/github-app'
import { normalizeSharedFolder, runCheckoutDir } from '../utils/storage'

// Prepare an isolated working directory for a run (projects.md §9): a
// self-contained shallow clone per run. Self-contained matters: the checkout
// is bind-mounted into the run's web container, and only a real clone (not a
// worktree, whose .git pointer would dangle at an unmounted host path) lets
// plain git work inside the sandbox: the web IDE's source control, the
// terminal, the agent. The clone's local git config wires that up
// (configureCheckout): bot identity for commits, and a credential helper that
// fetches short-lived repo-scoped tokens through the agent bridge for
// push/fetch.
//
// Auth for HOST-side network operations: a short-lived (1h) GitHub App
// installation token, passed per operation as an HTTP header: NEVER stored in
// the remote URL (it would go stale) and NEVER streamed to the run log; git
// output is captured quietly here and any error is redacted before it
// surfaces.
export async function prepareRunCheckout(
  project: Project,
  runId: number,
  token: string,
  onLog: (line: string) => void,
  branch: string = project.defaultBranch,
): Promise<string> {
  const dir = runCheckoutDir(runId)
  const url = `https://github.com/${project.fullName}.git`

  try {
    if (existsSync(join(dir, '.git'))) {
      onLog(`Reusing checkout at ${dir}\n`)
    }
    else {
      onLog(`Cloning ${project.fullName} (${branch})…\n`)
      await git([...authFlags(token), 'clone', '--depth', '1', '--branch', branch, url, dir])
    }

    shieldGeneratedFiles(dir, project.sharedFolders)
    await configureCheckout(dir, runId)
    return dir
  }
  catch (e) {
    // Redact the token so it can never reach the (UI-visible) run log.
    throw new Error(redact(String((e as Error).message), token), { cause: e })
  }
}

// Wire the clone so plain git works INSIDE the sandbox (the web IDE, the
// terminal, the agent): commits carry the bot identity, push/fetch get a
// short-lived repo-scoped token from the agent bridge (the `knecht-git
// credential` helper, mounted into every web container), and a branch created
// in the IDE pushes without upstream ceremony. All local config in the run's
// own .git, so it survives container recreates and never enters a commit.
async function configureCheckout(dir: string, runId: number): Promise<void> {
  const identity = (await getBotIdentity()) ?? FALLBACK_IDENTITY
  await git(['-C', dir, 'config', 'user.name', identity.name])
  await git(['-C', dir, 'config', 'user.email', identity.email])
  await git(['-C', dir, 'config', 'push.autoSetupRemote', 'true'])
  const base = await bridgeBaseUrl()
  // No resolvable bridge (docker-less dev): local git still works, push/fetch
  // from inside the sandbox just has no credentials.
  if (!base) return
  const env = `KNECHT_BRIDGE_URL=${base}/agent-bridge KNECHT_BRIDGE_TOKEN=${bridgeToken(runId)} KNECHT_RUN_ID=${runId}`
  await git(['-C', dir, 'config', 'credential.helper', `!${env} knecht-git credential`])
}

// Per-invocation auth for git network ops (the actions/checkout pattern): the
// installation token rides in an extra HTTP header instead of the remote URL,
// so nothing long-lived is written to disk.
function authFlags(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return ['-c', `http.https://github.com/.extraheader=Authorization: Basic ${basic}`]
}

// Create a new branch at the checkout's current HEAD (the `create-branch` block).
export async function createBranch(dir: string, name: string): Promise<void> {
  await git(['-C', dir, 'checkout', '-b', name])
}

// The branch the checkout is currently on. The checkout is the source of
// truth (the agent creates branches with plain git, so a DB-tracked branch
// would go stale); runs.branch is only synced back at publish moments.
export async function currentBranch(dir: string): Promise<string> {
  const { stdout } = await git(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'])
  return stdout.trim()
}

// A commit's author identity. Callers pass the GitHub App's bot identity
// (github-app.ts getBotIdentity) when available so commits link to the app's
// account. The fallback deliberately avoids users.noreply.github.com: such an
// address attributes commits to whatever REAL GitHub account owns the prefix
// (knecht@... belongs to the unrelated user 'knecht').
export interface CommitIdentity { name: string, email: string }
const FALLBACK_IDENTITY: CommitIdentity = { name: 'Knecht', email: 'noreply@knecht.works' }

// Stage and commit (the `create-commit` block and the agent bridge's commit
// op). Stages the whole working tree, or only `paths` when given (how the
// agent commits in logical chunks). Returns the new commit SHA, or null when
// nothing was staged (e.g. the agent changed nothing): a no-op, not a failure.
// The identity is set inline since the run container has none configured; a
// `coauthor` (the member who sent a follow-up) lands as a trailer.
export async function commitAll(
  dir: string,
  message: string,
  opts?: { identity?: CommitIdentity | null, paths?: string[], coauthor?: CommitIdentity },
): Promise<string | null> {
  if (opts?.paths?.length) await git(['-C', dir, 'add', '--', ...opts.paths])
  else await git(['-C', dir, 'add', '-A'])
  const { stdout: staged } = await git(['-C', dir, 'diff', '--cached', '--name-only'])
  if (!staged.trim()) return null
  const identity = opts?.identity ?? FALLBACK_IDENTITY
  const body = opts?.coauthor
    ? `${message}\n\nCo-authored-by: ${opts.coauthor.name} <${opts.coauthor.email}>`
    : message
  await git([
    '-C', dir,
    '-c', `user.name=${identity.name}`,
    '-c', `user.email=${identity.email}`,
    'commit', '-m', body,
  ])
  const { stdout } = await git(['-C', dir, 'rev-parse', 'HEAD'])
  return stdout.trim()
}

// Whether the working tree has uncommitted changes (staged, unstaged or
// untracked): what the follow-up epilogue checks before its fallback commit.
export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  const { stdout } = await git(['-C', dir, 'status', '--porcelain'])
  return Boolean(stdout.trim())
}

// Push the run's branch to origin (the `create-pr` block, before opening the PR).
// Auth rides in the per-invocation header (authFlags); the token is redacted
// from any error before it surfaces.
export async function pushBranch(dir: string, branch: string, token: string): Promise<void> {
  try {
    await git(['-C', dir, ...authFlags(token), 'push', 'origin', `HEAD:refs/heads/${branch}`])
  }
  catch (e) {
    throw new Error(redact(String((e as Error).message), token), { cause: e })
  }
}

// Knecht writes generated files into the checkout: the ddev overrides
// (`.ddev/config.knecht.yaml` carries the project's env vars, which include
// SECRETS; `.ddev/docker-compose.knecht.yaml` the run's compose override) and
// the agent's state dir (`.knecht/`: opencode config + session DB). The git
// blocks run `git add -A`, so without this they would be committed and pushed
// in the opened PR. The ignores go in the clone's `info/exclude`, so the
// generated files can never enter a commit. The project's shared folders join
// the list: their contents (uploads) surface inside the checkout via the bind
// mount and must never be committed even when the repo forgot to git-ignore
// them. Idempotent.
function shieldGeneratedFiles(dir: string, sharedFolders: string[]): void {
  const exclude = join(dir, '.git', 'info', 'exclude')
  const patterns = [
    '/.ddev/config.knecht.yaml',
    '/.ddev/docker-compose.knecht.yaml',
    '/.ddev/mysql/00-knecht-lowmem.cnf',
    '/.knecht/',
    ...sharedFolders.map(normalizeSharedFolder).filter(p => p !== null).map(p => `/${p}/`),
  ]
  try {
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
    const lines = current.split('\n')
    const missing = patterns.filter(p => !lines.includes(p))
    if (!missing.length) return
    appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`)
  }
  catch {
    // Best-effort; if it ever fails, a stray override is caught in PR review.
  }
}

function git(args: string[]) {
  return execa('git', args)
}

function redact(text: string, token: string): string {
  if (!token) return text
  // Redact the raw token and its base64 header form (authFlags), either of
  // which git may echo back in an error.
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return text.split(token).join('***').split(basic).join('***')
}
