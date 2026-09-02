import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { db, schema } from '../../db'
import { projectDumpDir } from '../../utils/storage'
import { detectPreviewFavicon } from '../../utils/favicon'
import { getSessionRow } from '../../utils/entities'
import { sessionPreviewUrl } from '../../utils/preview-target'
import { readDdevConfig } from '../../daemon/ddev'
import { restartDevServer, waitForDevServer } from '../../daemon/dev-server'
import { defineAction, type ActionRuntime } from './types'

const yamlParams = z.object({ commands: z.string().optional() })

export const ddevStartAction = defineAction({
  type: 'ddev-start',
  params: {
    commands: z.string().optional(),
  },
  // Keep the bare `- ddev-start` literal working alongside the params form
  // (the derived default would only accept the object form). `boot` is the
  // same step under the name that fits repos without ddev; both normalize to
  // the one type the runner and the restore path key on.
  yaml: z.union([
    z.literal('ddev-start').transform((): Step => ({ type: 'ddev-start' })),
    z.literal('boot').transform((): Step => ({ type: 'ddev-start' })),
    z.object({ 'ddev-start': yamlParams })
      .transform(({ 'ddev-start': p }): Step => ({ type: 'ddev-start', ...p })),
    z.object({ boot: yamlParams })
      .transform(({ boot: p }): Step => ({ type: 'ddev-start', ...p })),
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
      // A dev server starts with its container and only answers once it is
      // up (a stopped env revived by ensureUp, a stack rebuilt for a changed
      // definition): wait for it so the run's preview is browsable.
      const port = getSessionRow(rt.sessionId)?.previewPort
      if (port != null) await waitForDevServer(rt.sessionId, port)
      return previewOutputs(rt)
    }
    // Only stacks with a db container import the dump: a generated
    // environment has none (nor has a tracked config that omits the db), and
    // a dump configured for it is a setup error worth a plain message before
    // a whole stack boots for nothing.
    const hasDb = readDdevConfig(rt.checkoutDir)?.hasDb ?? true
    if (!hasDb && rt.project.dbDumpPath) {
      throw new Error('A database dump is configured, but this environment has no database container. Remove the dump or give the environment a database.')
    }
    const { code } = await rt.sandbox.stream(['ddev', 'start'])
    if (code !== 0) throw new Error(`ddev start exited with code ${code}`)
    if (hasDb) await importDb(rt)
    // The project's own boot commands first (how THIS project boots, from the
    // project settings), then the step's workflow-specific extras. Together
    // they are what a restore later re-runs (daemon/envs.ts). Each group is
    // announced in the log so the run page shows where a command came from.
    const exec = async (c: string) => (await rt.sandbox.stream(['bash', '-lc', c])).code
    if (rt.project.bootCommands.trim()) rt.log(`\nBoot commands (project settings):\n`)
    await runSetupCommands(rt.project.bootCommands, exec, rt.log)
    if (step.commands?.trim()) rt.log(`\nAdditional setup commands (this workflow's boot step):\n`)
    await runSetupCommands(step.commands, exec, rt.log)
    // A generated environment with a dev server (the port was pinned on the
    // session at checkout): its daemon died before the boot commands
    // installed its dependencies, restart it now and wait for the port.
    const port = getSessionRow(rt.sessionId)?.previewPort
    if (port != null) {
      rt.log(`\n▶ Starting the dev server on port ${port}\n`)
      await restartDevServer(async command => (await rt.sandbox.stream(command)).code)
      await waitForDevServer(rt.sessionId, port)
    }
    // Boot, DB import and the setup commands are through: the session is
    // booted, which is what previewReady records (envState 'up' alone only
    // means the containers run). For an environment with a preview target
    // this is also the moment the site becomes browsable in the UI; a
    // headless one sets it just the same, so the next run skips the boot.
    db.update(schema.sessions).set({ previewReady: true }).where(eq(schema.sessions.id, rt.sessionId)).run()
    const outputs = previewOutputs(rt)
    // The repo scan found no favicon for this project: the running site is
    // the second chance (icons generated at build time or served by the CMS).
    // Fire-and-forget; failures just keep the generic project icon.
    if (outputs && !rt.project.favicon) void detectPreviewFavicon(rt.sessionId, rt.project)
    return outputs
  },
})

// The preview URL for later blocks (e.g. a PR body), mirroring the
// per-session origin the preview proxy serves; nothing for an environment
// without one (utils/preview-target.ts).
function previewOutputs(rt: ActionRuntime): { url: string } | undefined {
  const session = getSessionRow(rt.sessionId)
  const url = session && sessionPreviewUrl(session)
  return url ? { url } : undefined
}

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
