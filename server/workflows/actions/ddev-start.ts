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
    await rt.sandbox.ensureUp()
    // Boot once per session: re-running the DB import and setup would wipe live state.
    if (sessionBooted(rt.sessionId)) {
      rt.log(`Environment already booted in this session: nothing to do\n`)
      const port = getSessionRow(rt.sessionId)?.previewPort
      if (port != null) await waitForDevServer(rt.sessionId, port)
      return previewOutputs(rt)
    }
    const hasDb = readDdevConfig(rt.checkoutDir)?.hasDb ?? true
    if (!hasDb && rt.project.dbDumpPath) {
      throw new Error('A database dump is configured, but this environment has no database container. Remove the dump or give the environment a database.')
    }
    const { code } = await rt.sandbox.stream(['ddev', 'start'])
    if (code !== 0) throw new Error(`ddev start exited with code ${code}`)
    if (hasDb) await importDb(rt)
    const exec = async (c: string) => (await rt.sandbox.stream(['bash', '-lc', c])).code
    if (rt.project.bootCommands.trim()) rt.log(`\nBoot commands (project settings):\n`)
    await runSetupCommands(rt.project.bootCommands, exec, rt.log)
    if (step.commands?.trim()) rt.log(`\nAdditional setup commands (this workflow's boot step):\n`)
    await runSetupCommands(step.commands, exec, rt.log)
    // The dev server died before the boot commands installed its dependencies; restart it.
    const port = getSessionRow(rt.sessionId)?.previewPort
    if (port != null) {
      rt.log(`\n▶ Starting the dev server on port ${port}\n`)
      await restartDevServer(async command => (await rt.sandbox.stream(command)).code)
      await waitForDevServer(rt.sessionId, port)
    }
    db.update(schema.sessions).set({ previewReady: true }).where(eq(schema.sessions.id, rt.sessionId)).run()
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

export function joinBootCommands(projectCommands: string, stepCommands: string | undefined): string {
  return [projectCommands, stepCommands ?? ''].filter(Boolean).join('\n')
}

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

function sessionBooted(sessionId: number): boolean {
  return db.select({ previewReady: schema.sessions.previewReady })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get()?.previewReady ?? false
}

async function importDb(rt: ActionRuntime): Promise<void> {
  if (!rt.project.dbDumpPath) return

  const file = join(projectDumpDir(rt.project.id), basename(rt.project.dbDumpPath))
  if (!existsSync(file)) {
    throw new Error(`DB dump not found at ${file}`)
  }

  rt.log(`\n▶ import-db (${basename(file)})\n`)
  const { code } = await rt.sandbox.stream(['ddev', 'import-db', `--file=${file}`])
  if (code !== 0) throw new Error(`ddev import-db exited with code ${code}`)
}
