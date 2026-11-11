import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, statfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { H3Event } from 'h3'
import { formatBytes } from '../../shared/utils/bytes'

// The dashboard sends files as the raw request body: multipart makes h3 buffer the whole file in memory.
export async function receiveUpload(event: H3Event, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const size = Number(getRequestHeader(event, 'content-length'))
  if (size) {
    const { bavail, bsize } = await statfs(dirname(dest))
    const free = bavail * bsize
    if (size > free) {
      throw createError({ statusCode: 507, statusMessage: `Not enough disk space: the file needs ${formatBytes(size)}, the server has ${formatBytes(free)} free.` })
    }
  }
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
