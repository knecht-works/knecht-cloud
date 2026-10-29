import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import type { Step } from '../../../shared/utils/workflow'
import { projectDumpDir } from '../../utils/storage'
import { detectPreviewFavicon } from '../../utils/favicon'
import { sessionPreviewUrl } from '../../utils/preview-target'
import { readDdevConfig } from '../../daemon/ddev'
import { waitForDevServer } from '../../daemon/dev-server'
import { bootEnv, inTransition, promoteToPreview } from '../../daemon/envs'
import { defineAction, type ActionRuntime } from './types'
import { getSessionRow } from '../../stores/sessions'

const yamlParams = z.object({ commands: z.string().optional() })

export const ddevStartAction = defineAction({
  type: 'ddev-start',
  params: {
    commands: z.string().optional(),
  },
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
    // Boot once per session: re-running the DB import and setup would wipe live state.
    if (getSessionRow(rt.sessionId)?.tier === 'preview') {
      await rt.sandbox.ensureUp()
      rt.log(`Environment already booted in this session: nothing to do\n`)
      const port = getSessionRow(rt.sessionId)?.previewPort
      if (port != null) await waitForDevServer(rt.sessionId, port)
      return previewOutputs(rt)
    }
    const hasDb = readDdevConfig(rt.checkoutDir)?.hasDb ?? true
    if (!hasDb && rt.project.dbDumpPath) {
      throw new Error('A database dump is configured, but this environment has no database container. Remove the dump or give the environment a database.')
    }
    await inTransition(rt.sessionId, 'booting', async () => {
      await bootEnv(rt.sessionId, {
        dbFile: dumpFile(rt),
        projectCommands: rt.project.bootCommands,
        stepCommands: step.commands,
        log: rt.log,
        signal: rt.signal,
      })
      promoteToPreview(rt.sessionId)
    })
    const outputs = previewOutputs(rt)
    if (outputs && !rt.project.favicon) void detectPreviewFavicon(rt.sessionId, rt.project)
    return outputs
  },
})

function previewOutputs(rt: ActionRuntime): { url: string } | undefined {
  const session = getSessionRow(rt.sessionId)
  const url = session && sessionPreviewUrl(session)
  return url ? { url } : undefined
}

function dumpFile(rt: ActionRuntime): string | null {
  if (!rt.project.dbDumpPath) return null
  const file = join(projectDumpDir(rt.project.id), basename(rt.project.dbDumpPath))
  if (!existsSync(file)) throw new Error(`DB dump not found at ${file}`)
  return file
}
