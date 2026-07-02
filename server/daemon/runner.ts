import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { Octokit } from 'octokit'
import { db, schema } from '../db'
import type { Project } from '../db/schema'
import { getWorkflow } from '../workflows'
import type { Step } from '../workflows/schema'
import { createContext, render, type RunContext } from '../workflows/context'
import { projectDumpDir, runSandboxName } from '../utils/storage'
import { createBranch, commitAll, prepareRunCheckout, pushBranch } from './git'
import { readDdevHosts, writeDdevConfig } from './ddev'
import { copyIntoSandbox, execInSandbox } from './sandbox'
import { ensureEnvUp } from './envs'

// The in-process serial runner (tech-stack.md §4). Each run gets its OWN
// sandbox (run-isolation.md): an isolated git worktree bind-mounted into a
// per-run Sysbox container, whose inner daemon boots the project's full ddev
// stack — router included — and a freshly-imported DB. Project-facing steps
// (ddev, bash/agent) exec INSIDE the sandbox; git steps run host-side against
// the worktree. The run row tracks both the run status and the environment
// state (envState = the sandbox's state), which the preview proxy and the
// idle-stopper read. SSE is deferred — the UI polls the row.

// Kick off a run. Returns immediately; execution continues in the background.
export function startRun(runId: number, project: Project, token: string): void {
  void execRun(runId, project, token).catch((e) => {
    appendLog(runId, `\nRunner crashed: ${(e as Error).message}\n`)
    finish(runId, 'failed')
  })
}

async function execRun(runId: number, project: Project, token: string): Promise<void> {
  const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get()
  const workflow = run && getWorkflow(run.workflow)
  if (!run || !workflow) {
    if (run) finish(runId, 'failed')
    return
  }

  db.update(schema.runs)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(schema.runs.id, runId))
    .run()

  try {
    appendLog(runId, `▶ Preparing isolated checkout\n`)
    const dir = await prepareRunCheckout(project, runId, token, line => appendLog(runId, line))

    // Read the repo's own ddev host set and store it (the proxy serves the
    // whole set — readDdevHosts — under per-run preview origins; the UI builds
    // its host switcher from the stored list).
    const hosts = readDdevHosts(dir)
    db.update(schema.runs)
      .set({ previewHost: hosts.primary, previewHosts: hosts.all })
      .where(eq(schema.runs.id, runId))
      .run()

    const injected = writeDdevConfig(dir, project.envVars)
    appendLog(runId, `Sandbox: ${runSandboxName(runId)} (host ${hosts.primary ?? '?'}, +${injected} env var(s))\n`)

    const ctx = createContext(runId, project)
    for (const step of workflow.steps) {
      await runStep(runId, dir, step, project, ctx, token)
    }
    appendLog(runId, `\n✓ Done\n`)
    finish(runId, 'success')
  }
  catch (e) {
    appendLog(runId, `\n✗ ${(e as Error).message}\n`)
    finish(runId, 'failed')
  }
}

async function runStep(
  runId: number,
  cwd: string,
  step: Step,
  project: Project,
  ctx: RunContext,
  token: string,
): Promise<void> {
  switch (step.type) {
    case 'ddev-start': {
      appendLog(runId, `\n▶ ddev-start\n`)
      await ensureEnvUp(runId)
      const code = await streamInSandbox(runId, ['ddev', 'start'])
      if (code !== 0) throw new Error(`ddev start exited with code ${code}`)
      // Expose the preview URL to later blocks (e.g. a PR body). Mirrors the
      // per-run origin the preview proxy serves.
      const previewUrl = previewOrigin(runId)
      if (previewUrl) ctx.preview = { url: previewUrl }
      await importDb(runId, project)
      break
    }
    case 'bash': {
      const command = render(step.command, ctx)
      appendLog(runId, `\n▶ bash: ${command}\n`)
      // Project-facing commands (ddev, the agent, builds) run INSIDE the run's
      // sandbox, in the mounted checkout — never on the Knecht host.
      await ensureEnvUp(runId)
      const code = await streamInSandbox(runId, ['bash', '-lc', command])
      if (code !== 0 && !step.continueOnError) {
        throw new Error(`Command exited with code ${code}`)
      }
      break
    }
    case 'create-branch': {
      const name = render(step.name, ctx)
      appendLog(runId, `\n▶ create-branch: ${name}\n`)
      await createBranch(cwd, name)
      ctx.branch = { name }
      db.update(schema.runs).set({ branch: name }).where(eq(schema.runs.id, runId)).run()
      break
    }
    case 'create-commit': {
      const message = render(step.message, ctx)
      appendLog(runId, `\n▶ create-commit: ${message}\n`)
      const sha = await commitAll(cwd, message)
      if (sha) {
        ctx.commit = { sha, created: true }
        appendLog(runId, `Committed ${sha.slice(0, 8)}\n`)
      }
      else {
        ctx.commit = { created: false }
        appendLog(runId, `Nothing to commit — skipping\n`)
      }
      break
    }
    case 'create-pr': {
      const branch = (ctx.branch as { name?: string } | undefined)?.name
      if (!branch) throw new Error('create-pr requires a preceding create-branch step')
      const title = render(step.title, ctx)
      const body = render(step.body, ctx)
      appendLog(runId, `\n▶ create-pr: ${title}\n`)
      await pushBranch(cwd, branch, token)
      try {
        const octokit = new Octokit({ auth: token })
        const { data } = await octokit.rest.pulls.create({
          owner: project.owner,
          repo: project.name,
          title,
          body,
          head: branch,
          base: project.defaultBranch,
        })
        ctx.pr = { url: data.html_url, number: data.number }
        db.update(schema.runs).set({ prUrl: data.html_url }).where(eq(schema.runs.id, runId)).run()
        appendLog(runId, `Opened PR #${data.number}: ${data.html_url}\n`)
      }
      catch (e) {
        const msg = (e as Error).message
        // Nothing was committed (e.g. an empty agent run) — there's no diff to
        // open a PR for. Treat as a skip, not a failure.
        if (/No commits between/i.test(msg)) {
          appendLog(runId, `No changes to open a PR for — skipping\n`)
          break
        }
        throw new Error(`create-pr failed: ${msg}`, { cause: e })
      }
      break
    }
  }
}

// Import the project's DB dump into this run's fresh environment (projects.md
// §6). Each run env is isolated, so the import happens per run (idle reboots
// keep the sandbox and don't re-import). The dump lives in Knecht's data dir,
// which the sandbox can't see — copy it in, then import inside.
async function importDb(runId: number, project: Project): Promise<void> {
  if (!project.dbDumpPath) return

  // Rebuild the path against the current data dir + filename so it's valid here,
  // where the upload landed (the stored path reflects wherever the upload ran).
  const file = join(projectDumpDir(project.id), basename(project.dbDumpPath))
  if (!existsSync(file)) {
    throw new Error(`DB dump not found at ${file}`)
  }

  appendLog(runId, `\n▶ import-db (${basename(file)})\n`)
  const inSandbox = `/tmp/${basename(file)}`
  await copyIntoSandbox(runId, file, inSandbox)
  const code = await streamInSandbox(runId, ['ddev', 'import-db', `--file=${inSandbox}`])
  if (code !== 0) throw new Error(`ddev import-db exited with code ${code}`)
}

// Run a command in the sandbox, streaming its stdout/stderr into the run log.
// Resolves with the exit code (never rejects on a non-zero exit — the caller
// decides).
function streamInSandbox(runId: number, command: string[]): Promise<number> {
  const sub = execInSandbox(runId, command, { reject: false, buffer: false })
  sub.stdout?.on('data', (d: Buffer) => appendLog(runId, d.toString()))
  sub.stderr?.on('data', (d: Buffer) => appendLog(runId, d.toString()))
  return sub.then(r => r.exitCode ?? 1)
}

function appendLog(runId: number, text: string): void {
  db.update(schema.runs)
    .set({ log: sql`${schema.runs.log} || ${text}` })
    .where(eq(schema.runs.id, runId))
    .run()
}

function finish(runId: number, status: 'success' | 'failed'): void {
  db.update(schema.runs)
    .set({ status, finishedAt: new Date() })
    .where(eq(schema.runs.id, runId))
    .run()
}
