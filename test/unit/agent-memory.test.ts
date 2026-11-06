import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionRuntime } from '../../server/workflows/actions/types'
import { AGENT_CONFIG_SUBDIR, agentMemoryFiles, installAgentFiles, MEMORY_SUBDIR, persistAgentMemory, projectMemoryDir } from '../../server/utils/agent-memory'

const PROJECT = 7

beforeEach(() => {
  vi.stubEnv('KNECHT_DATA_DIR', mkdtempSync(join(tmpdir(), 'knecht-memtest-')))
})

// Stands in for the session container: every command runs with the checkout as its working dir.
function sandboxAt(dir: string): ActionRuntime['sandbox'] {
  return {
    exec: async (command: string[], opts?: { input?: string | Uint8Array }) =>
      String((await execa(command[0]!, command.slice(1), { cwd: dir, input: opts?.input, stripFinalNewline: false })).stdout),
  } as ActionRuntime['sandbox']
}

function checkout(): string {
  return mkdtempSync(join(tmpdir(), 'knecht-memco-'))
}

function checkoutMemoryDir(dir: string): string {
  const memory = join(dir, MEMORY_SUBDIR)
  mkdirSync(memory, { recursive: true })
  return memory
}

function store(files: Record<string, string>): void {
  const dir = projectMemoryDir(PROJECT)
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
}

async function seed(dir: string, files: Record<string, string> = {}): Promise<void> {
  const memory = Object.entries(await agentMemoryFiles(PROJECT)).map(([name, text]) => [`memory/${name}`, text])
  await installAgentFiles(sandboxAt(dir), { ...files, ...Object.fromEntries(memory) })
}

describe('installAgentFiles', () => {
  it('writes the config and copies the host store into the checkout', async () => {
    store({ 'MEMORY.md': '- styles: see styles.md\n', 'styles.md': 'Tailwind via vite\n' })
    const dir = checkout()
    await seed(dir, { 'opencode.json': '{}', 'workflow.md': 'do it\n' })
    const memory = join(dir, MEMORY_SUBDIR)
    expect(readFileSync(join(dir, AGENT_CONFIG_SUBDIR, 'opencode.json'), 'utf8')).toBe('{}')
    expect(readFileSync(join(dir, AGENT_CONFIG_SUBDIR, 'workflow.md'), 'utf8')).toBe('do it\n')
    expect(readFileSync(join(memory, 'MEMORY.md'), 'utf8')).toBe('- styles: see styles.md\n')
    expect(readFileSync(join(memory, 'styles.md'), 'utf8')).toBe('Tailwind via vite\n')
  })

  it('bootstraps an empty index and workflow when none exist', async () => {
    const dir = checkout()
    await seed(dir)
    expect(readFileSync(join(dir, MEMORY_SUBDIR, 'MEMORY.md'), 'utf8')).toBe('')
    expect(readFileSync(join(dir, AGENT_CONFIG_SUBDIR, 'workflow.md'), 'utf8')).toBe('')
  })

  it('keeps the workflow of an earlier step when none is given', async () => {
    const dir = checkout()
    await seed(dir, { 'workflow.md': 'step prompt\n' })
    await seed(dir)
    expect(readFileSync(join(dir, AGENT_CONFIG_SUBDIR, 'workflow.md'), 'utf8')).toBe('step prompt\n')
  })

  it('replaces leftovers from an earlier step in the checkout', async () => {
    store({ 'MEMORY.md': 'fresh\n' })
    const dir = checkout()
    writeFileSync(join(checkoutMemoryDir(dir), 'stale.md'), 'gone\n')
    await seed(dir)
    expect(readdirSync(join(dir, MEMORY_SUBDIR))).toEqual(['MEMORY.md'])
  })

  it('replaces planted links instead of writing or deleting through them', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'knecht-outside-'))
    writeFileSync(join(outside, 'knecht.db'), 'DB')
    mkdirSync(join(outside, 'memory'))
    writeFileSync(join(outside, 'memory', 'other.md'), 'other project\n')
    const dir = checkout()
    mkdirSync(join(dir, AGENT_CONFIG_SUBDIR), { recursive: true })
    symlinkSync(join(outside, 'knecht.db'), join(dir, AGENT_CONFIG_SUBDIR, 'opencode.json'))
    symlinkSync(join(outside, 'memory'), join(dir, MEMORY_SUBDIR))
    await seed(dir, { 'opencode.json': '{}' })
    expect(readFileSync(join(outside, 'knecht.db'), 'utf8')).toBe('DB')
    expect(readFileSync(join(outside, 'memory', 'other.md'), 'utf8')).toBe('other project\n')
    expect(readFileSync(join(dir, AGENT_CONFIG_SUBDIR, 'opencode.json'), 'utf8')).toBe('{}')
  })
})

describe('persistAgentMemory', () => {
  it('copies the agent-written memory back into the store', async () => {
    store({ 'MEMORY.md': 'old\n' })
    const dir = checkout()
    const memory = checkoutMemoryDir(dir)
    writeFileSync(join(memory, 'MEMORY.md'), '- deploy: see deploy.md\n')
    writeFileSync(join(memory, 'deploy.md'), 'rsync to prod\n')
    const log = vi.fn()
    await persistAgentMemory(PROJECT, sandboxAt(dir), log)
    expect(readFileSync(join(projectMemoryDir(PROJECT), 'MEMORY.md'), 'utf8')).toBe('- deploy: see deploy.md\n')
    expect(readFileSync(join(projectMemoryDir(PROJECT), 'deploy.md'), 'utf8')).toBe('rsync to prod\n')
    expect(log).not.toHaveBeenCalled()
  })

  it('creates the store when the agent writes the first memory', async () => {
    const dir = checkout()
    writeFileSync(join(checkoutMemoryDir(dir), 'MEMORY.md'), 'first note\n')
    await persistAgentMemory(PROJECT, sandboxAt(dir), vi.fn())
    expect(readFileSync(join(projectMemoryDir(PROJECT), 'MEMORY.md'), 'utf8')).toBe('first note\n')
  })

  it('keeps the previous store when the index exceeds its cap', async () => {
    store({ 'MEMORY.md': 'kept\n' })
    const dir = checkout()
    writeFileSync(join(checkoutMemoryDir(dir), 'MEMORY.md'), 'x'.repeat(3 * 1024))
    const log = vi.fn()
    await persistAgentMemory(PROJECT, sandboxAt(dir), log)
    expect(readFileSync(join(projectMemoryDir(PROJECT), 'MEMORY.md'), 'utf8')).toBe('kept\n')
    expect(log).toHaveBeenCalledOnce()
  })

  it('keeps the previous store when the directory exceeds its cap', async () => {
    store({ 'MEMORY.md': 'kept\n' })
    const dir = checkout()
    const memory = checkoutMemoryDir(dir)
    writeFileSync(join(memory, 'MEMORY.md'), 'ok\n')
    writeFileSync(join(memory, 'big.md'), 'x'.repeat(65 * 1024))
    const log = vi.fn()
    await persistAgentMemory(PROJECT, sandboxAt(dir), log)
    expect(existsSync(join(projectMemoryDir(PROJECT), 'big.md'))).toBe(false)
    expect(readFileSync(join(projectMemoryDir(PROJECT), 'MEMORY.md'), 'utf8')).toBe('kept\n')
    expect(log).toHaveBeenCalledOnce()
  })

  it('takes only plain top-level markdown files', async () => {
    const dir = checkout()
    const memory = checkoutMemoryDir(dir)
    writeFileSync(join(memory, 'MEMORY.md'), 'index\n')
    writeFileSync(join(memory, 'notes.txt'), 'not markdown\n')
    writeFileSync(join(memory, '.hidden.md'), 'dotfile\n')
    mkdirSync(join(memory, 'sub'))
    writeFileSync(join(memory, 'sub', 'nested.md'), 'nested\n')
    const huge = join(mkdtempSync(join(tmpdir(), 'knecht-memhuge-')), 'huge.md')
    writeFileSync(huge, 'x'.repeat(100 * 1024))
    symlinkSync(huge, join(memory, 'link.md'))
    const log = vi.fn()
    await persistAgentMemory(PROJECT, sandboxAt(dir), log)
    expect(readdirSync(projectMemoryDir(PROJECT))).toEqual(['MEMORY.md'])
    expect(log).not.toHaveBeenCalled()
  })

  it('does not follow a memory dir that is a link to another checkout', async () => {
    store({ 'MEMORY.md': 'kept\n' })
    const other = checkout()
    writeFileSync(join(other, 'README.md'), 'other session\n')
    const dir = checkout()
    mkdirSync(join(dir, AGENT_CONFIG_SUBDIR), { recursive: true })
    symlinkSync(other, join(dir, MEMORY_SUBDIR))
    await persistAgentMemory(PROJECT, sandboxAt(dir), vi.fn())
    expect(readdirSync(projectMemoryDir(PROJECT))).toEqual(['MEMORY.md'])
  })

  it('reads all notes in one call, and a crafted file name cannot shift the others', async () => {
    const dir = checkout()
    const memory = checkoutMemoryDir(dir)
    writeFileSync(join(memory, 'MEMORY.md'), 'index\n')
    writeFileSync(join(memory, 'x\nevil.md'), 'smuggled\n')
    writeFileSync(join(memory, 'notes.md'), 'a b\nc\n')
    const sandbox = sandboxAt(dir)
    const exec = vi.spyOn(sandbox, 'exec')
    await persistAgentMemory(PROJECT, sandbox, vi.fn())
    expect(exec).toHaveBeenCalledOnce()
    expect(readdirSync(projectMemoryDir(PROJECT)).sort()).toEqual(['MEMORY.md', 'notes.md'])
    expect(readFileSync(join(projectMemoryDir(PROJECT), 'notes.md'), 'utf8')).toBe('a b\nc\n')
  })

  it('never throws, even without a checkout memory dir', async () => {
    store({ 'MEMORY.md': 'kept\n' })
    await persistAgentMemory(PROJECT, sandboxAt(checkout()), vi.fn())
    expect(readFileSync(join(projectMemoryDir(PROJECT), 'MEMORY.md'), 'utf8')).toBe('kept\n')
  })
})
