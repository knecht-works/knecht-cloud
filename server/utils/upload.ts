import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, statfs, truncate } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { H3Event } from 'h3'
import { formatBytes } from '../../shared/utils/bytes'

function intHeader(event: H3Event, name: string): number | undefined {
  const header = getRequestHeader(event, name)
  if (header === undefined) return undefined
  return /^\d+$/.test(header) ? Number(header) : NaN
}

// The dashboard sends files as the raw request body: multipart makes h3 buffer the whole file in memory.
// The declared size is required so the free-space check cannot be skipped and the stream stays bounded.
// Large files arrive in chunks (X-Upload-Offset / X-Upload-Total): Node drops any request still running
// after 5 minutes (server.requestTimeout), and a failed chunk can be resent without starting over.
// Resolves true once the file is complete at `dest`, false while more chunks are expected.
export async function receiveUpload(event: H3Event, dest: string): Promise<boolean> {
  const size = intHeader(event, 'content-length') ?? NaN
  if (!Number.isSafeInteger(size)) {
    throw createError({ statusCode: 411, statusMessage: 'The upload must declare its size (Content-Length).' })
  }
  const offset = intHeader(event, 'x-upload-offset') ?? 0
  const total = intHeader(event, 'x-upload-total') ?? size
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(total) || offset + size > total) {
    throw createError({ statusCode: 400, statusMessage: 'The upload chunk does not fit the declared total size.' })
  }

  const part = `${dest}.part`
  await mkdir(dirname(dest), { recursive: true })
  if (offset > 0) {
    const have = await stat(part).then(s => s.size, () => 0)
    if (offset > have) {
      throw createError({ statusCode: 409, statusMessage: 'The upload is missing earlier data. Please start it again.' })
    }
  }
  const { bavail, bsize } = await statfs(dirname(dest))
  const free = bavail * bsize
  if (total - offset > free) {
    throw createError({ statusCode: 507, statusMessage: `Not enough disk space: the file needs ${formatBytes(total)}, the server has ${formatBytes(free)} free.` })
  }

  let received = 0
  const cap = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length
      if (received > size) done(createError({ statusCode: 413, statusMessage: 'The upload is larger than it declared.' }))
      else done(null, chunk)
    },
  })
  try {
    await pipeline(event.node.req, cap, createWriteStream(part, offset > 0 ? { flags: 'r+', start: offset } : {}))
    if (received !== size) throw createError({ statusCode: 400, statusMessage: 'The upload ended early.' })
    // A failed earlier attempt at this chunk may have written past it.
    await truncate(part, offset + size)
    if (offset + size < total) return false
    await rename(part, dest)
    return true
  }
  catch (e) {
    // A chunked upload keeps its part so the client can resend the chunk.
    if (total === size) await rm(part, { force: true })
    throw e
  }
}
