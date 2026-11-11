import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, statfs } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { H3Event } from 'h3'
import { formatBytes } from '../../shared/utils/bytes'

// The dashboard sends files as the raw request body: multipart makes h3 buffer the whole file in memory.
// The declared size is required so the free-space check cannot be skipped and the stream stays bounded.
export async function receiveUpload(event: H3Event, dest: string): Promise<void> {
  const header = getRequestHeader(event, 'content-length')
  const size = header && /^\d+$/.test(header) ? Number(header) : NaN
  if (!Number.isSafeInteger(size)) {
    throw createError({ statusCode: 411, statusMessage: 'The upload must declare its size (Content-Length).' })
  }
  await mkdir(dirname(dest), { recursive: true })
  const { bavail, bsize } = await statfs(dirname(dest))
  const free = bavail * bsize
  if (size > free) {
    throw createError({ statusCode: 507, statusMessage: `Not enough disk space: the file needs ${formatBytes(size)}, the server has ${formatBytes(free)} free.` })
  }

  let received = 0
  const cap = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length
      if (received > size) done(createError({ statusCode: 413, statusMessage: 'The upload is larger than it declared.' }))
      else done(null, chunk)
    },
  })
  const part = `${dest}.part`
  try {
    await pipeline(event.node.req, cap, createWriteStream(part))
    await rename(part, dest)
  }
  catch (e) {
    await rm(part, { force: true })
    throw e
  }
}
