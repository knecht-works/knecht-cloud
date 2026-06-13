import { existsSync } from 'node:fs'
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
// The OAuth token doubles as the clone credential (tech-stack.md §3); it is
// embedded in the remote URL but NEVER streamed to the run log — git output is
// captured quietly here and any error is redacted before it surfaces.
export async function prepareRunCheckout(
  project: Project,
  runId: number,
  token: string,
  onLog: (line: string) => void,
): Promise<string> {
  const base = projectCheckoutDir(project)
  const runDir = runWorktreeDir(runId)
  const branch = project.defaultBranch

  try {
    await ensureBaseClone(base, project, token, branch, onLog)

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
  const authUrl = `https://oauth2:${token}@github.com/${project.fullName}.git`
  if (existsSync(join(base, '.git'))) {
    onLog(`Fetching ${branch}…\n`)
    await git(['-C', base, 'fetch', '--depth', '1', 'origin', branch])
  }
  else {
    onLog(`Cloning ${project.fullName} (${branch})…\n`)
    await git(['clone', '--no-checkout', '--depth', '1', '--branch', branch, authUrl, base])
  }
}

function git(args: string[]) {
  return execa('git', args)
}

function redact(text: string, token: string): string {
  return token ? text.split(token).join('***') : text
}
