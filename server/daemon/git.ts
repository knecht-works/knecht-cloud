import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import type { Project } from '../db/schema'
import { projectCheckoutDir, runWorktreeDir } from '../utils/storage'

// Prepare an isolated working directory for a run (projects.md §9). We keep one
// base clone per project and add a detached git worktree per run, so every run
// gets its own checkout while sharing the object store — lighter than a full
// clone each time. Detached (not a branch) avoids git's "a branch can only be
// checked out in one worktree" rule when several runs share the default branch.
//
// Auth: a short-lived (1h) GitHub App installation token, passed per network
// operation as an HTTP header — NEVER stored in the remote URL (it would go
// stale) and NEVER streamed to the run log — git output is captured quietly
// here and any error is redacted before it surfaces.
export async function prepareRunCheckout(
  project: Project,
  runId: number,
  token: string,
  onLog: (line: string) => void,
  branch: string = project.defaultBranch,
): Promise<string> {
  const base = projectCheckoutDir(project)
  const runDir = runWorktreeDir(runId)

  try {
    // The base stays a single-branch shallow clone of the default branch (the
    // shared object store); a run on any other branch fetches that branch's tip
    // into an explicit remote-tracking ref so the worktree can be created at it.
    await ensureBaseClone(base, project, token, project.defaultBranch, onLog)
    shieldGeneratedFiles(base)

    if (branch !== project.defaultBranch) {
      onLog(`Fetching ${branch}…\n`)
      await git(['-C', base, ...authFlags(token), 'fetch', '--depth', '1', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
    }

    if (existsSync(join(runDir, '.git'))) {
      onLog(`Reusing worktree at ${runDir}\n`)
    }
    else {
      onLog(`Creating isolated worktree for run ${runId}…\n`)
      await git(['-C', base, 'worktree', 'add', '--detach', '--force', runDir, `origin/${branch}`])
    }
    return runDir
  }
  catch (e) {
    // Redact the token so it can never reach the (UI-visible) run log.
    throw new Error(redact(String((e as Error).message), token), { cause: e })
  }
}

async function ensureBaseClone(
  base: string,
  project: Project,
  token: string,
  branch: string,
  onLog: (line: string) => void,
): Promise<void> {
  const cleanUrl = `https://github.com/${project.fullName}.git`
  if (existsSync(join(base, '.git'))) {
    // Heal clones from the old scheme that still carry a token in the URL.
    await git(['-C', base, 'remote', 'set-url', 'origin', cleanUrl])
    onLog(`Fetching ${branch}…\n`)
    // Explicit refspec: the base clone is single-branch, so a plain fetch of a
    // DIFFERENT branch (project branch changed since the clone) would land in
    // FETCH_HEAD only and never create the origin/<branch> the worktree add needs.
    await git(['-C', base, ...authFlags(token), 'fetch', '--depth', '1', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
  }
  else {
    onLog(`Cloning ${project.fullName} (${branch})…\n`)
    await git([...authFlags(token), 'clone', '--no-checkout', '--depth', '1', '--branch', branch, cleanUrl, base])
  }
}

// Per-invocation auth for git network ops (the actions/checkout pattern): the
// installation token rides in an extra HTTP header instead of the remote URL,
// so nothing long-lived is written to disk.
function authFlags(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return ['-c', `http.https://github.com/.extraheader=Authorization: Basic ${basic}`]
}

// Create a new branch at the worktree's current HEAD (the `create-branch` block).
export async function createBranch(dir: string, name: string): Promise<void> {
  await git(['-C', dir, 'checkout', '-b', name])
}

// Stage and commit the whole working tree (the `create-commit` block). Returns
// the new commit SHA, or null when there was nothing to commit (e.g. the agent
// changed nothing) — the caller treats that as a no-op, not a failure. A commit
// identity is set inline since the run container has none configured.
export async function commitAll(dir: string, message: string): Promise<string | null> {
  await git(['-C', dir, 'add', '-A'])
  const { stdout: status } = await git(['-C', dir, 'status', '--porcelain'])
  if (!status.trim()) return null
  await git([
    '-C', dir,
    '-c', 'user.name=Knecht',
    '-c', 'user.email=knecht@users.noreply.github.com',
    'commit', '-m', message,
  ])
  const { stdout } = await git(['-C', dir, 'rev-parse', 'HEAD'])
  return stdout.trim()
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

// Knecht writes `.ddev/config.knecht.yaml` into the worktree to isolate the run
// (unique ddev name) and inject the project's env vars — which include SECRETS.
// The git blocks run `git add -A`, so without this that file (secrets and all)
// would be committed and pushed in the opened PR. The ignore goes in the base
// clone's shared `info/exclude` (honored by every worktree hanging off it), so
// the generated override can never enter a commit. Idempotent.
function shieldGeneratedFiles(base: string): void {
  const exclude = join(base, '.git', 'info', 'exclude')
  const pattern = '/.ddev/config.knecht.yaml'
  try {
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
    if (current.split('\n').includes(pattern)) return
    appendFileSync(exclude, `${current && !current.endsWith('\n') ? '\n' : ''}${pattern}\n`)
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
