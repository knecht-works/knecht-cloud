import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from './storage'

// Per-project agent memory: a host-side directory of markdown notes that
// survives across runs. MEMORY.md is the index (merged into the agent's
// instructions every invocation, so it is hard-capped); topic files hold the
// details and are read by the agent on demand. Seeded into the run's checkout
// before every opencode invocation and copied back after it.

export const MEMORY_SUBDIR = join('.knecht', 'opencode', 'memory')

// The index rides along in every system prompt; the cap keeps that cost fixed
// no matter how much a project accumulates. The dir cap bounds the store as a
// whole; both reject the whole copy-back, the previous store stays.
const MEMORY_INDEX_CAP = 2 * 1024
const MEMORY_DIR_CAP = 64 * 1024

// Flat store: plain markdown files only, no dotfiles. Names come from readdir
// (no separators), the regex documents and enforces the shape on top.
const MEMORY_FILE_RE = /^[\w-][\w.-]*\.md$/

export function projectMemoryDir(projectId: number): string {
  return join(dataDir(), 'memory', String(projectId))
}

// Seed the checkout from the host store. The checkout copy is always replaced
// (the store is the freshest state; copy-back ran after the last invocation),
// and MEMORY.md always ends up existing so the instructions path resolves and
// the agent can start a first memory on a project without one.
export async function seedAgentMemory(projectId: number, checkoutDir: string): Promise<void> {
  const store = projectMemoryDir(projectId)
  const dest = join(checkoutDir, MEMORY_SUBDIR)
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  for (const name of await listMemoryFiles(store)) {
    await copyFile(join(store, name), join(dest, name))
  }
  const index = join(dest, 'MEMORY.md')
  if (!existsSync(index)) await writeFile(index, '')
}

// Copy the checkout's memory back into the host store. Best-effort by
// contract: never throws, so a memory problem can neither fail a step nor
// mask its real error. The checkout dir is agent-controlled, so only vetted
// top-level markdown files are taken, and a cap violation rejects the whole
// copy-back (the previous store stays) with one log line.
export async function persistAgentMemory(
  projectId: number,
  checkoutDir: string,
  log: (text: string) => void,
): Promise<void> {
  try {
    const src = join(checkoutDir, MEMORY_SUBDIR)
    if (!existsSync(src)) return
    const names = await listMemoryFiles(src)

    let total = 0
    for (const name of names) {
      const size = (await stat(join(src, name))).size
      if (name === 'MEMORY.md' && size > MEMORY_INDEX_CAP) {
        log(`\nmemory: kept previous notes, MEMORY.md is ${formatKb(size)} (cap ${formatKb(MEMORY_INDEX_CAP)})\n`)
        return
      }
      total += size
    }
    if (total > MEMORY_DIR_CAP) {
      log(`\nmemory: kept previous notes, ${formatKb(total)} total (cap ${formatKb(MEMORY_DIR_CAP)})\n`)
      return
    }

    // Replace the store atomically: a crash mid-copy never leaves it half
    // written.
    const store = projectMemoryDir(projectId)
    const tmp = `${store}.tmp`
    await rm(tmp, { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    for (const name of names) {
      await copyFile(join(src, name), join(tmp, name))
    }
    await rm(store, { recursive: true, force: true })
    await rename(tmp, store)
  }
  catch (e) {
    log(`\nmemory: keeping previous notes, copy-back failed: ${(e as Error).message}\n`)
  }
}

// The vetted view of a memory dir: top-level regular files (Dirent check, so
// symlinks are never followed) with plain markdown names. Missing dir reads
// as empty.
async function listMemoryFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter(e => e.isFile() && MEMORY_FILE_RE.test(e.name)).map(e => e.name)
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}KB`
}
