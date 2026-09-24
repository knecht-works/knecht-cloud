import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { parse, stringify } from 'yaml'
import { toolsDir } from '../utils/storage'
import { readSandboxAsset } from '../utils/sandbox-assets'
import { stageIde } from '../daemon/ide'

// Without this global config the first `ddev start` boots a router that collides
// with Caddy on :80/:443. ~/.ddev because daemon/sandbox.ts strips XDG_CONFIG_HOME.
export default defineNitroPlugin(() => {
  try {
    ensureDdevGlobalConfig()
  }
  catch (e) {
    console.error('ddev global config setup failed:', (e as Error).message)
  }
  void stageAgentTools().catch(e =>
    console.error('agent tools staging failed:', (e as Error).message))
  void stageIde().catch(e =>
    console.error('openvscode-server staging failed:', (e as Error).message))
})

// v2 changes the config format and the ACP behaviour; bump only after testing against it.
const OPENCODE_VERSION = '1.18.32'

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

  for (const name of ['knecht-git', 'knecht-reply', 'knecht-label', 'knecht-status', 'knecht-object', 'knecht-bridge-lib', 'ddev-shim', 'knecht-forward']) {
    const content = await readSandboxAsset(name)
    if (!content) continue
    if (content.subarray(0, 2).toString() !== '#!') {
      throw new Error(`sandbox asset ${name} is corrupted (missing #! header)`)
    }
    const dest = join(tools, name)
    writeFileSync(dest, content)
    chmodSync(dest, 0o755)
  }

  const opencode = join(tools, 'opencode')
  const versionFile = `${opencode}.version`
  const staged = existsSync(opencode) && existsSync(versionFile) ? readFileSync(versionFile, 'utf8') : null
  if (staged !== OPENCODE_VERSION) {
    await execa('bash', ['-c', `curl -fsSL https://opencode.ai/install | bash -s -- --version ${OPENCODE_VERSION}`])
    // A new inode instead of overwriting: running sandboxes keep their bind-mounted binary until restart.
    await copyFile(join(homedir(), '.opencode', 'bin', 'opencode'), `${opencode}.tmp`)
    chmodSync(`${opencode}.tmp`, 0o755)
    await rename(`${opencode}.tmp`, opencode)
    writeFileSync(versionFile, OPENCODE_VERSION)
    console.log(`opencode ${OPENCODE_VERSION} staged into`, opencode)
  }
}
