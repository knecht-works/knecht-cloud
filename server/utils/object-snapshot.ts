import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import type { ActionRuntime } from '../workflows/actions/types'
import { tryParseJson } from './json'
import { sanitizeFilename } from './storage'

export const MAX_SNAPSHOT_FILE_BYTES = 20 * 1024 * 1024

export interface SnapshotFile {
  // Stable per upload in the tracker: a re-upload under the same name is a new id.
  id: string
  name: string
  type: string
  // Unknown until downloaded for trackers that only link their uploads.
  size?: number
  // Name and type may come with the download when only the id is known up front.
  download(): Promise<Buffer | { content: Buffer, name: string, type: string }>
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

interface Downloaded {
  id: string
  name: string
  type: string
  size: number
}

type Sandbox = ActionRuntime['sandbox']

const MANIFEST = '.attachments.json'
const LISTING_SEPARATOR = '--knecht-listing--'

function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const tooLarge = (name: string, bytes: number) => `- ${name} (${sizeLabel(bytes)}) not downloaded: over the ${sizeLabel(MAX_SNAPSHOT_FILE_BYTES)} limit`

const READ_SCRIPT = `d="$1"
[ -f "$d/${MANIFEST}" ] && head -c 1048576 "$d/${MANIFEST}"
printf '\\n${LISTING_SEPARATOR}\\n'
[ -d "$d/attachments" ] && ls -1A "$d/attachments"
exit 0`

// Read and written by the sandbox: on the host, a symlink planted in .knecht/objects would redirect the writes.
// The manifest is sandbox-writable too, so a tampered one only costs this sandbox its own files.
async function downloadedFiles(sandbox: Sandbox, dir: string): Promise<Downloaded[]> {
  const out = await sandbox.exec(['sh', '-c', READ_SCRIPT, 'sh', dir])
  const [manifest = '', listing = ''] = out.split(`\n${LISTING_SEPARATOR}\n`)
  const present = new Set(listing.split('\n').filter(Boolean))
  const entries = tryParseJson(manifest)
  if (!Array.isArray(entries)) return []
  return entries.filter((e): e is Downloaded =>
    typeof e?.id === 'string' && typeof e.name === 'string' && typeof e.type === 'string' && typeof e.size === 'number'
    && e.name === sanitizeFilename(e.name) && present.has(e.name))
}

// Attachments no longer on the ticket go; kept ones are not sent again.
const INSTALL_SCRIPT = `set -e
d="$1"
mkdir -p "$d/attachments"
t=$(mktemp -d)
tar -xf - -C "$t"
for f in "$d"/attachments/* "$d"/attachments/.[!.]*; do
  [ -e "$f" ] || [ -L "$f" ] || continue
  grep -qxF -- "\${f##*/}" "$t/.keep" || rm -rf -- "$f"
done
cp -R "$t/attachments/." "$d/attachments/"
rm -f "$d/ticket.json" "$d/ticket.md" "$d/${MANIFEST}"
cp "$t/ticket.json" "$t/ticket.md" "$t/${MANIFEST}" "$d/"
rm -rf "$t"`

export const snapshotDir = (key: string) => join('.knecht', 'objects', sanitizeFilename(key))

// Only this ticket's folder is touched: linked tickets loaded earlier stay where they are.
export async function writeObjectSnapshot(sandbox: Sandbox, snapshot: ObjectSnapshot, fetchedAt = new Date()): Promise<string> {
  const rel = snapshotDir(snapshot.key)
  const kept = new Map((await downloadedFiles(sandbox, rel)).map(d => [d.id, d]))
  const staging = await mkdtemp(join(tmpdir(), 'knecht-object-'))
  try {
    await mkdir(join(staging, 'attachments'))
    await writeFile(join(staging, 'ticket.json'), JSON.stringify(snapshot.data, null, 2))

    const current = snapshot.files.filter(f => kept.has(f.id)).map(f => kept.get(f.id)!)
    const taken = new Set(current.map(d => d.name))
    const lines = new Map<string, string>()
    await Promise.all(snapshot.files.filter(f => !kept.has(f.id)).map(async (file) => {
      if (file.size !== undefined && file.size > MAX_SNAPSHOT_FILE_BYTES) return lines.set(file.id, tooLarge(file.name, file.size))
      try {
        const downloaded = await file.download()
        const { content, name: original, type } = Buffer.isBuffer(downloaded) ? { content: downloaded, name: file.name, type: file.type } : downloaded
        if (content.length > MAX_SNAPSHOT_FILE_BYTES) return lines.set(file.id, tooLarge(original, content.length))
        let name = sanitizeFilename(original)
        for (let n = 2; taken.has(name); n++) name = sanitizeFilename(original).replace(/(\.[^.]*)?$/, `-${n}$1`)
        taken.add(name)
        await writeFile(join(staging, 'attachments', name), content)
        current.push({ id: file.id, name, type, size: content.length })
      }
      catch (e) {
        lines.set(file.id, `- ${file.name} not downloaded: ${(e as Error).message}`)
      }
    }))
    for (const d of current) lines.set(d.id, `- ${join(rel, 'attachments', d.name)} (${d.type || 'unknown type'}, ${sizeLabel(d.size)})`)
    const files = snapshot.files.map(f => lines.get(f.id)).filter(Boolean)

    const index = [
      `# ${snapshot.heading}`,
      snapshot.url,
      snapshot.facts.filter(Boolean).join(' · '),
      `Fetched at ${fetchedAt.toISOString()}`,
      '',
      `Full ${snapshot.contents}: ${join(rel, 'ticket.json')}`,
      ...(files.length ? ['', 'Attachments:', ...files] : []),
      ...(snapshot.links.length ? ['', 'Linked, load one with `knecht-object <KEY>`:', ...snapshot.links.map(l => `- ${l.key} (${l.relation}): ${l.title}`)] : []),
    ].join('\n')
    await writeFile(join(staging, 'ticket.md'), `${index}\n`)
    await writeFile(join(staging, MANIFEST), JSON.stringify(current))
    await writeFile(join(staging, '.keep'), current.map(d => `${d.name}\n`).join(''))

    const { stdout: archive } = await execa('tar', ['-cf', '-', '-C', staging, '.'], { encoding: 'buffer' })
    await sandbox.exec(['sh', '-c', INSTALL_SCRIPT, 'sh', rel], { input: archive })
    return `${index}\n\nThis index is saved as ${join(rel, 'ticket.md')}.`
  }
  finally {
    await rm(staging, { recursive: true, force: true })
  }
}
