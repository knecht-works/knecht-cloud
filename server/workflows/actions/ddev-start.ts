import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { db, schema } from '../../db'
import { projectDumpDir } from '../../utils/storage'
import { previewOrigin } from '../../utils/origin'
import { detectPreviewFavicon } from '../../utils/favicon'
import { defineAction, type ActionRuntime } from './types'

export const ddevStartAction = defineAction({
  type: 'ddev-start',
  params: {
    commands: z.string().optional(),
  },
  // Keep the bare `- ddev-start` literal working alongside the params form
  // (the derived default would only accept the object form).
  yaml: z.union([
    z.literal('ddev-start').transform((): Step => ({ type: 'ddev-start' })),
    z.object({ 'ddev-start': z.object({ commands: z.string().optional() }) })
      .transform(({ 'ddev-start': p }): Step => ({ type: 'ddev-start', ...p })),
  ]),
  legacyKey: 'preview',
  async run(step, rt) {
    rt.log(`\n▶ ddev-start\n`)
    // ensureUp starts the stack only when it isn't running (a stopped env's
    // volumes and checkout revive in seconds), so the booted path below is a
    // true no-op: no compose reconcile, no container recreates.
    await rt.sandbox.ensureUp()
    // The session boots ONCE: a later run's boot step in the same session
    // finds everything in place. DB import and the setup commands already
    // happened, and re-running them would wipe or churn the session's live
    // state. So every workflow can safely carry its own boot step; whichever
    // runs first in the session does the real work.
    if (sessionBooted(rt.sessionId)) {
      rt.log(`Environment already booted in this session: nothing to do\n`)
      const url = previewOrigin(rt.sessionId)
      return url ? { url } : undefined
    }
    const { code } = await rt.sandbox.stream(['ddev', 'start'])
    if (code !== 0) throw new Error(`ddev start exited with code ${code}`)
    await importDb(rt)
    // The project's own boot commands first (how THIS project boots, from the
    // project settings), then the step's workflow-specific extras. Together
    // they are what a restore later re-runs (daemon/envs.ts). Each group is
    // announced in the log so the run page shows where a command came from.
    const exec = async (c: string) => (await rt.sandbox.stream(['bash', '-lc', c])).code
    if (rt.project.bootCommands.trim()) rt.log(`\nBoot commands (project settings):\n`)
    await runSetupCommands(rt.project.bootCommands, exec, rt.log)
    if (step.commands?.trim()) rt.log(`\nAdditional setup commands (this workflow's boot step):\n`)
    await runSetupCommands(step.commands, exec, rt.log)
    // Boot, DB import and the setup commands are through: the site is actually
    // browsable now, so THIS is what makes the preview visible in the UI
    // (envState 'up' alone only means the containers run).
    db.update(schema.sessions).set({ previewReady: true }).where(eq(schema.sessions.id, rt.sessionId)).run()
    // The repo scan found no favicon for this project: the running site is
    // the second chance (icons generated at build time or served by the CMS).
    // Fire-and-forget; failures just keep the generic project icon.
    if (!rt.project.favicon) void detectPreviewFavicon(rt.sessionId, rt.project)
    // Expose the preview URL to later blocks (e.g. a PR body). Mirrors the
    // per-session origin the preview proxy serves.
    const previewUrl = previewOrigin(rt.sessionId)
    return previewUrl ? { url: previewUrl } : undefined
  },
})

// Project boot commands + the step's extras as one command list; either side
// may be empty. Exported so the archive restore rebuilds with the same set.
export function joinBootCommands(projectCommands: string, stepCommands: string | undefined): string {
  return [projectCommands, stepCommands ?? ''].filter(Boolean).join('\n')
}

// The optional setup commands (one per line), run after boot + DB
// import like dedicated bash steps would be: sequentially, first failure
// fails the step. `exec` runs one command and returns its exit code; exported
// so the archive restore (daemon/envs.ts) re-runs the commands with its own
// exec to rebuild what the archive doesn't carry (vendor/ and friends).
export async function runSetupCommands(
  commands: string | undefined,
  exec: (command: string) => Promise<number>,
  log: (text: string) => void = () => {},
): Promise<void> {
  const lines = (commands ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  for (const command of lines) {
    log(`\n▶ ${command}\n`)
    const code = await exec(command)
    if (code !== 0) throw new Error(`'${command}' exited with code ${code}`)
  }
}

// Whether the session already went through a full boot (DB import + setup
// commands): previewReady is set at the end of the first complete ddev-start
// and survives stop/archive/restore.
function sessionBooted(sessionId: number): boolean {
  return db.select({ previewReady: schema.sessions.previewReady })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get()?.previewReady ?? false
}

// Import the project's DB dump into the session's fresh environment
// (projects.md §6). Runs once per session (see sessionBooted above).
async function importDb(rt: ActionRuntime): Promise<void> {
  if (!rt.project.dbDumpPath) return

  // Rebuild the path against the current data dir + filename so it's valid here,
  // where the upload landed (the stored path reflects wherever the upload ran).
  const file = join(projectDumpDir(rt.project.id), basename(rt.project.dbDumpPath))
  if (!existsSync(file)) {
    throw new Error(`DB dump not found at ${file}`)
  }

  rt.log(`\n▶ import-db (${basename(file)})\n`)
  const { code } = await rt.sandbox.stream(['ddev', 'import-db', `--file=${file}`])
  if (code !== 0) throw new Error(`ddev import-db exited with code ${code}`)
}
