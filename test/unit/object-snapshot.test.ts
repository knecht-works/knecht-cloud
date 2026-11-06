import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { describe, expect, it, vi } from 'vitest'
import type { ActionRuntime } from '../../server/workflows/actions/types'
import { writeObjectSnapshot, type ObjectSnapshot, type SnapshotFile } from '../../server/utils/object-snapshot'

function localSandbox(dir: string) {
  return {
    exec: async ([cmd, ...args]: string[], opts?: { input?: string | Uint8Array }) => (await execa(cmd!, args, { cwd: dir, input: opts?.input })).stdout,
  } as unknown as ActionRuntime['sandbox']
}

function file(id: string, name: string, content = name): SnapshotFile & { download: ReturnType<typeof vi.fn> } {
  return { id, name, type: 'text/plain', download: vi.fn(async () => Buffer.from(content)) }
}

function snapshot(key: string, files: SnapshotFile[]): ObjectSnapshot {
  return { key, heading: `${key}: Login`, url: '', facts: [], body: '', comments: [], contents: 'ticket', data: { key }, files, links: [] }
}

describe('writeObjectSnapshot', () => {
  it('downloads an attachment once, drops removed ones and keeps other tickets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knecht-snapshot-'))
    const sandbox = localSandbox(dir)
    const attachments = join(dir, '.knecht', 'objects', 'PROJ-1', 'attachments')

    const log = file('a1', 'log.txt')
    const shot = file('a2', 'shot.png')
    await writeObjectSnapshot(sandbox, snapshot('PROJ-1', [log, shot]))
    await writeObjectSnapshot(sandbox, snapshot('PROJ-7', [file('b1', 'other.txt')]))
    expect(readdirSync(attachments).sort()).toEqual(['log.txt', 'shot.png'])

    const again = file('a1', 'log.txt')
    const reuploaded = file('a3', 'shot.png', 'new shot')
    const index = await writeObjectSnapshot(sandbox, snapshot('PROJ-1', [again, reuploaded]), new Date('2026-11-06T10:00:00Z'))
    expect(again.download).not.toHaveBeenCalled()
    expect(reuploaded.download).toHaveBeenCalledOnce()
    expect(readdirSync(attachments).sort()).toEqual(['log.txt', 'shot.png'])
    expect(readFileSync(join(attachments, 'shot.png'), 'utf8')).toBe('new shot')
    expect(index).toContain('Fetched at 2026-11-06T10:00:00.000Z')
    expect(index).toContain('- .knecht/objects/PROJ-1/attachments/log.txt (text/plain, 1 KB)')
    expect(readdirSync(join(dir, '.knecht', 'objects', 'PROJ-7', 'attachments'))).toEqual(['other.txt'])
  })

  it('downloads a kept attachment again when its file is gone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knecht-snapshot-'))
    const sandbox = localSandbox(dir)
    await writeObjectSnapshot(sandbox, snapshot('PROJ-1', [file('a1', 'log.txt')]))
    writeFileSync(join(dir, '.knecht', 'objects', 'PROJ-1', '.attachments.json'), JSON.stringify([{ id: 'a1', name: 'missing.txt', type: '', size: 1 }]))
    const again = file('a1', 'log.txt')
    await writeObjectSnapshot(sandbox, snapshot('PROJ-1', [again]))
    expect(again.download).toHaveBeenCalledOnce()
  })

  it('puts the description and the comments, oldest first, into ticket.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knecht-snapshot-'))
    await writeObjectSnapshot(localSandbox(dir), {
      ...snapshot('PROJ-1', []),
      body: 'It fails on submit.',
      comments: [
        { author: 'Bob', at: '2026-11-06T12:00:00Z', body: 'The code word is HAWK.' },
        { author: 'Ann', at: '2026-11-05T09:00:00Z', body: 'Cannot reproduce.' },
      ],
    })
    const md = readFileSync(join(dir, '.knecht', 'objects', 'PROJ-1', 'ticket.md'), 'utf8')
    expect(md).toContain('## Description\n\nIt fails on submit.')
    expect(md).toContain('## Comments (2, oldest first)\n\n### Ann · 2026-11-05T09:00:00Z\n\nCannot reproduce.\n\n### Bob · 2026-11-06T12:00:00Z\n\nThe code word is HAWK.')
  })
})
