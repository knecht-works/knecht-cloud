import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { projectDumpDir } from '../../utils/storage'
import { previewOrigin } from '../../utils/origin'
import { defineAction, type ActionRuntime } from './types'

export const ddevStartAction = defineAction({
  type: 'ddev-start',
  params: {},
  yaml: z.literal('ddev-start').transform((): Step => ({ type: 'ddev-start' })),
  legacyKey: 'preview',
  async run(_step, rt) {
    rt.log(`\n▶ ddev-start\n`)
    await rt.sandbox.ensureUp()
    const { code } = await rt.sandbox.stream(['ddev', 'start'])
    if (code !== 0) throw new Error(`ddev start exited with code ${code}`)
    await importDb(rt)
    // Expose the preview URL to later blocks (e.g. a PR body). Mirrors the
    // per-run origin the preview proxy serves.
    const previewUrl = previewOrigin(rt.runId)
    return previewUrl ? { url: previewUrl } : undefined
  },
})

// Import the project's DB dump into this run's fresh environment (projects.md
// §6). Each run env is isolated, so the import happens per run (idle reboots
// keep the sandbox and don't re-import). The dump lives in Knecht's data dir,
// which the sandbox can't see — copy it in, then import inside.
async function importDb(rt: ActionRuntime): Promise<void> {
  if (!rt.project.dbDumpPath) return

  // Rebuild the path against the current data dir + filename so it's valid here,
  // where the upload landed (the stored path reflects wherever the upload ran).
  const file = join(projectDumpDir(rt.project.id), basename(rt.project.dbDumpPath))
  if (!existsSync(file)) {
    throw new Error(`DB dump not found at ${file}`)
  }

  rt.log(`\n▶ import-db (${basename(file)})\n`)
  const inSandbox = `/tmp/${basename(file)}`
  await rt.sandbox.copyIn(file, inSandbox)
  const { code } = await rt.sandbox.stream(['ddev', 'import-db', `--file=${inSandbox}`])
  if (code !== 0) throw new Error(`ddev import-db exited with code ${code}`)
}
