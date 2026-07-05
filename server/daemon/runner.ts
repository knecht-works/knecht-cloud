import { eq, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project } from '../db/schema'
import { getWorkflow } from '../workflows'
import { actionFor, type ActionRuntime } from '../workflows/actions'
import { createContext, renderStepParams } from '../workflows/context'
import { runSandboxName } from '../utils/storage'
import { getInstallationToken } from '../utils/github-app'
import { prepareRunCheckout } from './git'
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
//
// Step execution is generic: each step's params are rendered against the run
// context, the registered action (server/workflows/actions) runs, and its
// returned patch is merged into the context for later steps to reference.

// Kick off a run. Returns immediately; execution continues in the background.
// Repo credentials are minted on demand from the GitHub App (github-app.ts) —
// installation tokens expire after 1h, so each git network operation fetches a
// fresh one instead of holding a single token across a possibly-long run.
export function startRun(runId: number, project: Project): void {
  void execRun(runId, project).catch((e) => {
    appendLog(runId, `\nRunner crashed: ${(e as Error).message}\n`)
    finish(runId, 'failed')
  })
}

async function execRun(runId: number, project: Project): Promise<void> {
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
    const token = await getInstallationToken(project.owner, project.name)
    const dir = await prepareRunCheckout(project, runId, token, line => appendLog(runId, line), run.branch ?? project.defaultBranch)

    // Read the repo's own ddev host set and store it (the proxy serves the
    // whole set — readDdevHosts — under per-run preview origins; the UI builds
    // its host switcher from the stored list).
    const hosts = readDdevHosts(dir)
    db.update(schema.runs)
      .set({ previewHosts: hosts.all })
      .where(eq(schema.runs.id, runId))
      .run()

    const injected = writeDdevConfig(dir, project.envVars)
    appendLog(runId, `Sandbox: ${runSandboxName(runId)} (host ${hosts.primary ?? '?'}, +${injected} env var(s))\n`)

    const ctx = createContext(runId, project)
    const rt: ActionRuntime = {
      runId,
      project,
      checkoutDir: dir,
      ctx,
      log: text => appendLog(runId, text),
      sandbox: {
        ensureUp: () => ensureEnvUp(runId),
        stream: command => streamInSandbox(runId, command),
        copyIn: (hostPath, sandboxPath) => copyIntoSandbox(runId, hostPath, sandboxPath),
      },
    }
    for (const step of workflow.steps) {
      const action = actionFor(step.type)
      const outputs = await action.run(renderStepParams(step, ctx), rt)
      if (outputs) {
        // steps.<id> is the collision-free reference; the legacy top-level key
        // keeps pre-id templates ({{ branch.name }}, {{ pr.url }}) rendering.
        if (step.id) ctx.steps[step.id] = outputs
        if (action.legacyKey) ctx[action.legacyKey] = outputs
      }
    }
    appendLog(runId, `\n✓ Done\n`)
    finish(runId, 'success')
  }
  catch (e) {
    appendLog(runId, `\n✗ ${(e as Error).message}\n`)
    finish(runId, 'failed')
  }
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
