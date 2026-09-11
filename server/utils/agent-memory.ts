import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from './storage'

export const MEMORY_SUBDIR = join('.knecht', 'opencode', 'memory')

const MEMORY_INDEX_CAP = 2 * 1024
const MEMORY_DIR_CAP = 64 * 1024

const MEMORY_FILE_RE = /^[\w-][\w.-]*\.md$/

export function projectMemoryDir(projectId: number): string {
  return join(dataDir(), 'memory', String(projectId))
}

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

// The checkout dir is agent-controlled: only vetted files are taken.
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

// Dirent check so symlinks are never followed.
async function listMemoryFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter(e => e.isFile() && MEMORY_FILE_RE.test(e.name)).map(e => e.name)
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}KB`
}
