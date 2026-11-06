import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sanitizeFilename } from './storage'

export const MAX_SNAPSHOT_FILE_BYTES = 20 * 1024 * 1024

export interface SnapshotFile {
  name: string
  type: string
  size: number
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

// The checkout's .knecht/ is git-excluded and bind-mounted, so the paths printed relative to it work inside the sandbox.
export async function writeObjectSnapshot(checkoutDir: string, snapshot: ObjectSnapshot): Promise<string> {
  const rel = join('.knecht', 'objects', sanitizeFilename(snapshot.key))
  const dir = join(checkoutDir, rel)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'attachments'), { recursive: true })
  writeFileSync(join(dir, 'ticket.json'), JSON.stringify(snapshot.data, null, 2))

  const taken = new Set<string>()
  const files = await Promise.all(snapshot.files.map(async (file) => {
    if (file.size > MAX_SNAPSHOT_FILE_BYTES) return `- ${file.name} (${sizeLabel(file.size)}) not downloaded: over the ${sizeLabel(MAX_SNAPSHOT_FILE_BYTES)} limit`
    let name = sanitizeFilename(file.name)
    for (let n = 2; taken.has(name); n++) name = name.replace(/(\.[^.]*)?$/, `-${n}$1`)
    taken.add(name)
    try {
      writeFileSync(join(dir, 'attachments', name), await file.download())
      return `- ${join(rel, 'attachments', name)} (${file.type}, ${sizeLabel(file.size)})`
    }
    catch (e) {
      return `- ${file.name} not downloaded: ${(e as Error).message}`
    }
  }))

  return [
    `# ${snapshot.heading}`,
    snapshot.url,
    snapshot.facts.filter(Boolean).join(' · '),
    '',
    `Full ${snapshot.contents}: ${join(rel, 'ticket.json')}`,
    ...(files.length ? ['', 'Attachments:', ...files] : []),
    ...(snapshot.links.length ? ['', 'Linked, load one with `knecht-object <KEY>`:', ...snapshot.links.map(l => `- ${l.key} (${l.relation}): ${l.title}`)] : []),
  ].join('\n')
}
