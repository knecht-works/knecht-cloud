import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { H3Event } from 'h3'

// The dashboard sends files as the raw request body: multipart makes h3 buffer the whole file in memory.
export async function receiveUpload(event: H3Event, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  try {
    await pipeline(event.node.req, createWriteStream(part))
    await rename(part, dest)
  }
  catch (e) {
    await rm(part, { force: true })
    throw e
  }
}
