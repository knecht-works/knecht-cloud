import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { parse, stringify } from 'yaml'
import { toolsDir } from '../utils/storage'
import { readSandboxAsset } from '../utils/sandbox-assets'
import { stageIde } from '../daemon/ide'

// One-time substrate preparation at boot (idempotent, best-effort):
//
//   1. The ddev global config for THIS process's user: the router and
//      ssh-agent are omitted (the preview proxy targets each run's web
//      container directly, so no router may bind host ports), mutagen stays
//      off, instrumentation off. Without this, the first `ddev start` would
//      boot a router that collides with Caddy on :80/:443.
//   2. The agent tools dir (dataDir/tools): the knecht-git bridge CLI (from
//      the bundled server assets) and the opencode binary (downloaded via the
//      official installer when missing). daemon/ddev.ts bind-mounts both into
//      every run's web container; when a tool is missing its mount is simply
//      omitted and the agent reports its git tools as unavailable.
export default defineNitroPlugin(() => {
  try {
    ensureDdevGlobalConfig()
  }
  catch (e) {
    console.error('ddev global config setup failed:', (e as Error).message)
  }
  void stageAgentTools().catch(e =>
    console.error('agent tools staging failed:', (e as Error).message))
  // The web IDE server (~120MB download): best-effort like the tools; the
  // first IDE click retries when this failed or hasn't finished yet.
  void stageIde().catch(e =>
    console.error('openvscode-server staging failed:', (e as Error).message))
})

const GLOBAL_CONFIG: Record<string, unknown> = {
  omit_containers: ['ddev-router', 'ddev-ssh-agent'],
  performance_mode: 'none',
  instrumentation_opt_in: false,
}

function ensureDdevGlobalConfig(): void {
  const dir = join(homedir(), '.ddev')
  const file = join(dir, 'global_config.yaml')
  mkdirSync(dir, { recursive: true })
  const current = existsSync(file)
    ? (parse(readFileSync(file, 'utf8')) as Record<string, unknown> | null) ?? {}
    : {}
  const merged = { ...current, ...GLOBAL_CONFIG }
  if (JSON.stringify(merged) !== JSON.stringify(current)) {
    writeFileSync(file, stringify(merged))
    console.log('ddev global config written (router and ssh-agent omitted)')
  }
}

async function stageAgentTools(): Promise<void> {
  const tools = toolsDir()
  await mkdir(tools, { recursive: true })

  // knecht-git and the in-container ddev shim ship as bundled server assets;
  // (re)write them every boot so updates propagate. The mounted files must be
  // executable.
  for (const name of ['knecht-git', 'ddev-shim']) {
    const content = await readSandboxAsset(name)
    if (!content) continue
    // Both tools are bash scripts. A mangled asset mounted into runs surfaces
    // as a baffling in-container failure; refuse it loudly at boot instead.
    if (content.subarray(0, 2).toString() !== '#!') {
      throw new Error(`sandbox asset ${name} is corrupted (missing #! header)`)
    }
    const dest = join(tools, name)
    writeFileSync(dest, content)
    chmodSync(dest, 0o755)
  }

  // opencode: fetched once via the official installer (it lands in
  // ~/.opencode/bin), then copied into the tools dir. Skipped when already
  // staged so an offline boot never blocks; delete the staged binary to
  // force a re-download on the next boot.
  const opencode = join(tools, 'opencode')
  if (!existsSync(opencode)) {
    await execa('bash', ['-c', 'curl -fsSL https://opencode.ai/install | bash'])
    await copyFile(join(homedir(), '.opencode', 'bin', 'opencode'), opencode)
    chmodSync(opencode, 0o755)
    console.log('opencode staged into', opencode)
  }
}
