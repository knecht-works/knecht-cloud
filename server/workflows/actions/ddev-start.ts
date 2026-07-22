import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { db, schema } from '../../db'
import { projectDumpDir } from '../../utils/storage'
import { previewOrigin } from '../../utils/origin'
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
    await rt.sandbox.ensureUp()
    const { code } = await rt.sandbox.stream(['ddev', 'start'])
    if (code !== 0) throw new Error(`ddev start exited with code ${code}`)
    await importDb(rt)
    await runSetupCommands(rt, step.commands)
    // Boot, DB import and the setup commands are through: the site is actually
    // browsable now, so THIS is what makes the preview visible in the UI
    // (envState 'up' alone only means the containers run).
    db.update(schema.runs).set({ previewReady: true }).where(eq(schema.runs.id, rt.runId)).run()
    // Expose the preview URL to later blocks (e.g. a PR body). Mirrors the
    // per-run origin the preview proxy serves.
    const previewUrl = previewOrigin(rt.runId)
    return previewUrl ? { url: previewUrl } : undefined
  },
})

// The step's optional setup commands (one per line), run after boot + DB
// import like dedicated bash steps would be: sequentially, first failure
// fails the step.
async function runSetupCommands(rt: ActionRuntime, commands?: string): Promise<void> {
  const lines = (commands ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  for (const command of lines) {
    rt.log(`\n▶ ${command}\n`)
    const { code } = await rt.sandbox.stream(['bash', '-lc', command])
    if (code !== 0) throw new Error(`'${command}' exited with code ${code}`)
  }
}

// Import the project's DB dump into this run's fresh environment (projects.md
// §6). Each run env is isolated, so the import happens per run (idle reboots
// keep the run's db volume and don't re-import). The ddev CLI runs host-side
// and reads the dump straight from the data dir.
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
