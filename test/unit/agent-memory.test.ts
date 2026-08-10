import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_SUBDIR, persistAgentMemory, projectMemoryDir, seedAgentMemory } from '../../server/utils/agent-memory'

const PROJECT = 7

// Fresh host-side data dir per test: dataDir() resolves KNECHT_DATA_DIR at
// call time, so stubbing here isolates the store between tests.
beforeEach(() => {
  vi.stubEnv('KNECHT_DATA_DIR', mkdtempSync(join(tmpdir(), 'knecht-memtest-')))
})

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

describe('seedAgentMemory', () => {
  it('copies the host store into the checkout', async () => {
    store({ 'MEMORY.md': '- styles: see styles.md\n', 'styles.md': 'Tailwind via vite\n' })
    const dir = checkout()
    await seedAgentMemory(PROJECT, dir)
    const memory = join(dir, MEMORY_SUBDIR)
    expect(readFileSync(join(memory, 'MEMORY.md'), 'utf8')).toBe('- styles: see styles.md\n')
    expect(readFileSync(join(memory, 'styles.md'), 'utf8')).toBe('Tailwind via vite\n')
  })

  it('bootstraps an empty index when no store exists', async () => {
    const dir = checkout()
    await seedAgentMemory(PROJECT, dir)
    expect(readFileSync(join(dir, MEMORY_SUBDIR, 'MEMORY.md'), 'utf8')).toBe('')
  })

  it('replaces leftovers from an earlier step in the checkout', async () => {
    store({ 'MEMORY.md': 'fresh\n' })
    const dir = checkout()
    writeFileSync(join(checkoutMemoryDir(dir), 'stale.md'), 'gone\n')
    await seedAgentMemory(PROJECT, dir)
    expect(readdirSync(join(dir, MEMORY_SUBDIR))).toEqual(['MEMORY.md'])
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
    await persistAgentMemory(PROJECT, dir, log)
    expect(readFileSync(join(projectMemoryDir(PROJECT), 'MEMORY.md'), 'utf8')).toBe('- deploy: see deploy.md\n')
    expect(readFileSync(join(projectMemoryDir(PROJECT), 'deploy.md'), 'utf8')).toBe('rsync to prod\n')
    expect(log).not.toHaveBeenCalled()
  })

  it('creates the store when the agent writes the first memory', async () => {
    const dir = checkout()
    writeFileSync(join(checkoutMemoryDir(dir), 'MEMORY.md'), 'first note\n')
    await persistAgentMemory(PROJECT, dir, vi.fn())
    expect(readFileSync(join(projectMemoryDir(PROJECT), 'MEMORY.md'), 'utf8')).toBe('first note\n')
  })

  it('keeps the previous store when the index exceeds its cap', async () => {
    store({ 'MEMORY.md': 'kept\n' })
    const dir = checkout()
    writeFileSync(join(checkoutMemoryDir(dir), 'MEMORY.md'), 'x'.repeat(3 * 1024))
    const log = vi.fn()
    await persistAgentMemory(PROJECT, dir, log)
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
    await persistAgentMemory(PROJECT, dir, log)
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
    // A symlink to a file far over the cap: must be ignored, not followed.
    const huge = join(mkdtempSync(join(tmpdir(), 'knecht-memhuge-')), 'huge.md')
    writeFileSync(huge, 'x'.repeat(100 * 1024))
    symlinkSync(huge, join(memory, 'link.md'))
    const log = vi.fn()
    await persistAgentMemory(PROJECT, dir, log)
    expect(readdirSync(projectMemoryDir(PROJECT))).toEqual(['MEMORY.md'])
    expect(log).not.toHaveBeenCalled()
  })

  it('never throws, even without a checkout memory dir', async () => {
    store({ 'MEMORY.md': 'kept\n' })
    await persistAgentMemory(PROJECT, join(tmpdir(), 'knecht-mem-does-not-exist'), vi.fn())
    expect(readFileSync(join(projectMemoryDir(PROJECT), 'MEMORY.md'), 'utf8')).toBe('kept\n')
  })
})
