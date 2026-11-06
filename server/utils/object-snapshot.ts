import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import type { ActionRuntime } from '../workflows/actions/types'
import { sanitizeFilename } from './storage'

export const MAX_SNAPSHOT_FILE_BYTES = 20 * 1024 * 1024

export interface SnapshotFile {
  name: string
  type: string
  // Unknown until downloaded for trackers that only link their uploads.
  size?: number
  download(): Promise<Buffer>
}

export interface SnapshotLink {
  key: string
  relation: string
  title: string
}

export interface ObjectSnapshot {
  key: string
  heading: string
  url: string
  facts: string[]
  // What the raw file holds, for the agent to know where to look.
  contents: string
  data: unknown
  files: SnapshotFile[]
  links: SnapshotLink[]
}

function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const tooLarge = (name: string, bytes: number) => `- ${name} (${sizeLabel(bytes)}) not downloaded: over the ${sizeLabel(MAX_SNAPSHOT_FILE_BYTES)} limit`

// Unpacked by the sandbox: on the host, a symlink planted in .knecht/objects would redirect the writes.
const INSTALL_SCRIPT = `set -e
rm -rf "$1"
mkdir -p "$1"
tar -xf - -C "$1"`

// The paths are relative to the checkout, so they work as the agent's working directory.
export async function writeObjectSnapshot(sandbox: ActionRuntime['sandbox'], snapshot: ObjectSnapshot): Promise<string> {
  const rel = join('.knecht', 'objects', sanitizeFilename(snapshot.key))
  const staging = await mkdtemp(join(tmpdir(), 'knecht-object-'))
  try {
    await mkdir(join(staging, 'attachments'))
    await writeFile(join(staging, 'ticket.json'), JSON.stringify(snapshot.data, null, 2))

    const taken = new Set<string>()
    const files = await Promise.all(snapshot.files.map(async (file) => {
      if (file.size !== undefined && file.size > MAX_SNAPSHOT_FILE_BYTES) return tooLarge(file.name, file.size)
      let name = sanitizeFilename(file.name)
      for (let n = 2; taken.has(name); n++) name = name.replace(/(\.[^.]*)?$/, `-${n}$1`)
      taken.add(name)
      try {
        const content = await file.download()
        if (content.length > MAX_SNAPSHOT_FILE_BYTES) return tooLarge(file.name, content.length)
        await writeFile(join(staging, 'attachments', name), content)
        return `- ${join(rel, 'attachments', name)} (${file.type || 'unknown type'}, ${sizeLabel(content.length)})`
      }
      catch (e) {
        return `- ${file.name} not downloaded: ${(e as Error).message}`
      }
    }))

    const index = [
      `# ${snapshot.heading}`,
      snapshot.url,
      snapshot.facts.filter(Boolean).join(' · '),
      '',
      `Full ${snapshot.contents}: ${join(rel, 'ticket.json')}`,
      ...(files.length ? ['', 'Attachments:', ...files] : []),
      ...(snapshot.links.length ? ['', 'Linked, load one with `knecht-object <KEY>`:', ...snapshot.links.map(l => `- ${l.key} (${l.relation}): ${l.title}`)] : []),
    ].join('\n')
    await writeFile(join(staging, 'ticket.md'), `${index}\n`)

    const { stdout: archive } = await execa('tar', ['-cf', '-', '-C', staging, '.'], { encoding: 'buffer' })
    await sandbox.exec(['sh', '-c', INSTALL_SCRIPT, 'sh', rel], { input: archive })
    return `${index}\n\nThis index is saved as ${join(rel, 'ticket.md')}.`
  }
  finally {
    await rm(staging, { recursive: true, force: true })
  }
}
