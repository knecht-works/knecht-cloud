import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Attachment } from '../db/schema'
import { dataDir, sanitizeFilename } from './storage'

export const MAX_ATTACHMENTS = 5
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const SANDBOX_ATTACHMENTS_DIR = '/tmp/knecht-attachments'

export function followupAttachmentsDir(followupId: number): string {
  return join(dataDir(), 'attachments', String(followupId))
}

export function sandboxAttachmentPath(followupId: number, name: string): string {
  return `${SANDBOX_ATTACHMENTS_DIR}/${followupId}/${name}`
}

export interface UploadedFile {
  filename: string
  type: string
  data: Buffer
}

// Names are sanitized and made unique so two "screenshot.png" never overwrite each other.
export function saveAttachments(followupId: number, files: UploadedFile[]): Attachment[] {
  if (!files.length) return []
  const dir = followupAttachmentsDir(followupId)
  mkdirSync(dir, { recursive: true })
  const taken = new Set<string>()
  return files.map((file) => {
    let name = sanitizeFilename(file.filename)
    for (let n = 2; taken.has(name); n++) name = name.replace(/(\.[^.]*)?$/, `-${n}$1`)
    taken.add(name)
    writeFileSync(join(dir, name), file.data)
    return { name, size: file.data.length, type: file.type }
  })
}

export function removeAttachments(followupIds: number[]): void {
  for (const id of followupIds) rmSync(followupAttachmentsDir(id), { recursive: true, force: true })
}
