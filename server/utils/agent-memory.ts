import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import type { ActionRuntime } from '../workflows/actions/types'
import { dataDir } from './storage'

// The checkout is sandbox-writable, so Knecht only touches these paths through the
// sandbox: on the host, a planted symlink would redirect writes and reads to Knecht's own files.
export const AGENT_CONFIG_SUBDIR = '.knecht/opencode'
export const MEMORY_SUBDIR = `${AGENT_CONFIG_SUBDIR}/memory`

const MEMORY_INDEX_CAP = 2 * 1024
const MEMORY_DIR_CAP = 64 * 1024

const MEMORY_FILE_RE = /^[\w-][\w.-]*\.md$/

type Sandbox = ActionRuntime['sandbox']

export function projectMemoryDir(projectId: number): string {
  return join(dataDir(), 'memory', String(projectId))
}

export async function agentMemoryFiles(projectId: number): Promise<Record<string, string>> {
  const store = projectMemoryDir(projectId)
  const files: Record<string, string> = {}
  for (const name of await listMemoryFiles(store)) {
    files[name] = await readFile(join(store, name), 'utf8')
  }
  return files
}

// The memory dir is replaced, never merged: notes from an earlier step must not linger.
// workflow.md and MEMORY.md always exist so the static paths in the generated config resolve.
const INSTALL_SCRIPT = `set -e
d=${AGENT_CONFIG_SUBDIR}
mkdir -p "$d"
rm -rf "$d/memory"
mkdir -p "$d/memory"
tar -xf - -C "$d"
[ -e "$d/workflow.md" ] || : > "$d/workflow.md"
[ -e "$d/memory/MEMORY.md" ] || : > "$d/memory/MEMORY.md"`

export async function installAgentFiles(sandbox: Sandbox, files: Record<string, string | Uint8Array>): Promise<void> {
  const staging = await mkdtemp(join(tmpdir(), 'knecht-agent-'))
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(staging, path, '..'), { recursive: true })
      await writeFile(join(staging, path), text)
    }
    const { stdout: archive } = await execa('tar', ['-cf', '-', '-C', staging, '.'], { encoding: 'buffer' })
    await sandbox.exec(['sh', '-c', INSTALL_SCRIPT], { input: archive })
  }
  finally {
    await rm(staging, { recursive: true, force: true })
  }
}

// One line per file, name and content each base64: the host only ever parses text,
// never an archive or a path the sandbox could shape.
const DUMP_SCRIPT = `[ -d "$1" ] && [ ! -L "$1" ] || exit 0
for f in "$1"/*.md; do
  [ -f "$f" ] && [ ! -L "$f" ] || continue
  printf '%s %s\\n' "$(printf '%s' "\${f##*/}" | base64 | tr -d '\\n')" "$(head -c "$2" "$f" | base64 | tr -d '\\n')"
done`

// Read through the sandbox: a symlink there resolves in the container, which holds
// only this session's checkout, never another session's files or Knecht's data.
export async function persistAgentMemory(
  projectId: number,
  sandbox: Sandbox,
  log: (text: string) => void,
): Promise<void> {
  try {
    const dump = await sandbox.exec(['sh', '-c', DUMP_SCRIPT, 'sh', MEMORY_SUBDIR, String(MEMORY_DIR_CAP + 1)])
    const entries = dump.split('\n').filter(Boolean).map((line) => {
      const [name = '', content = ''] = line.split(' ')
      return { name: Buffer.from(name, 'base64').toString('utf8'), text: Buffer.from(content, 'base64').toString('utf8') }
    }).filter(e => MEMORY_FILE_RE.test(e.name))
    if (!entries.length) return

    const files: Record<string, string> = {}
    let total = 0
    for (const { name, text } of entries) {
      const size = Buffer.byteLength(text)
      if (name === 'MEMORY.md' && size > MEMORY_INDEX_CAP) {
        log(`\nmemory: kept previous notes, MEMORY.md is ${formatKb(size)} (cap ${formatKb(MEMORY_INDEX_CAP)})\n`)
        return
      }
      total += size
      if (total > MEMORY_DIR_CAP) {
        log(`\nmemory: kept previous notes, more than ${formatKb(MEMORY_DIR_CAP)} in total\n`)
        return
      }
      files[name] = text
    }

    const store = projectMemoryDir(projectId)
    const tmp = `${store}.tmp`
    await rm(tmp, { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    for (const [name, text] of Object.entries(files)) {
      await writeFile(join(tmp, name), text)
    }
    await rm(store, { recursive: true, force: true })
    await rename(tmp, store)
  }
  catch (e) {
    log(`\nmemory: keeping previous notes, copy-back failed: ${(e as Error).message}\n`)
  }
}

// Dirent check so symlinks are never followed.
async function listMemoryFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter(e => e.isFile() && MEMORY_FILE_RE.test(e.name)).map(e => e.name)
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}KB`
}
