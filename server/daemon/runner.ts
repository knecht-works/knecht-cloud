import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execa } from 'execa'
import { eq, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import type { Project } from '../db/schema'
import { getWorkflow } from '../workflows'
import type { Step } from '../workflows/schema'
import { projectDumpDir, runEnvName } from '../utils/storage'
import { prepareRunCheckout } from './git'
import { ensureOnDdevNetwork, readDdevHost, writeDdevConfig } from './ddev'

// The in-process serial runner (tech-stack.md §4). Each run gets its OWN ddev
// environment: an isolated git worktree, a unique ddev project name, its own
// containers and freshly-imported DB. The run row tracks both the run status
// and the environment state (envState), which the preview proxy and the idle-
// stopper read. SSE is deferred — the UI polls the row.

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

    // Read the repo's own ddev host and store it. The booted app keeps using it
    // (the pasted .env is applied verbatim); the proxy sends it as Host and
    // rewrites it to the preview origin in responses — no env-var pinning.
    const previewHost = readDdevHost(dir)
    db.update(schema.runs).set({ previewHost }).where(eq(schema.runs.id, runId)).run()

    const injected = writeDdevConfig(dir, runEnvName(runId), project.envVars)
    appendLog(runId, `Env: ${runEnvName(runId)} (host ${previewHost ?? '?'}, +${injected} env var(s))\n`)

    for (const step of workflow.steps) {
      await runStep(runId, dir, step, project)
    }
    appendLog(runId, `\n✓ Done\n`)
    finish(runId, 'success')
  }
  catch (e) {
    appendLog(runId, `\n✗ ${(e as Error).message}\n`)
    finish(runId, 'failed')
  }
}

async function runStep(runId: number, cwd: string, step: Step, project: Project): Promise<void> {
  switch (step.type) {
    case 'ddev-start': {
      appendLog(runId, `\n▶ ddev-start\n`)
      const code = await stream(runId, 'ddev', ['start'], cwd)
      if (code !== 0) throw new Error(`ddev start exited with code ${code}`)
      // The env (and ddev's shared network) exist now — make sure the Knecht
      // container can reach this run's web container directly for the preview.
      await ensureOnDdevNetwork()
      // The environment is up and previewable now, even if later steps fail.
      db.update(schema.runs)
        .set({ envState: 'up', previewLastSeen: new Date() })
        .where(eq(schema.runs.id, runId))
        .run()
      await importDb(runId, cwd, project)
      break
    }
    case 'bash': {
      appendLog(runId, `\n▶ bash: ${step.command}\n`)
      const code = await stream(runId, 'bash', ['-c', step.command], cwd)
      if (code !== 0 && !step.continueOnError) {
        throw new Error(`Command exited with code ${code}`)
      }
      break
    }
  }
}

// Import the project's DB dump into this run's fresh environment (projects.md
// §6). Each run env is isolated, so the import happens per run (idle reboots
// keep the volume and don't re-import).
async function importDb(runId: number, cwd: string, project: Project): Promise<void> {
  if (!project.dbDumpPath) return

  // Rebuild the path against the current data dir + filename so it's valid here,
  // where ddev runs (the stored path reflects wherever the upload ran).
  const file = join(projectDumpDir(project.id), basename(project.dbDumpPath))
  if (!existsSync(file)) {
    throw new Error(`DB dump not found at ${file}`)
  }

  appendLog(runId, `\n▶ import-db (${basename(file)})\n`)
  const code = await stream(runId, 'ddev', ['import-db', `--file=${file}`], cwd)
  if (code !== 0) throw new Error(`ddev import-db exited with code ${code}`)
}

// Spawn a process and stream its stdout/stderr into the run log. Resolves with
// the exit code (never rejects on a non-zero exit — the caller decides).
function stream(runId: number, file: string, args: string[], cwd: string): Promise<number> {
  const sub = execa(file, args, { cwd, reject: false, buffer: false })
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
