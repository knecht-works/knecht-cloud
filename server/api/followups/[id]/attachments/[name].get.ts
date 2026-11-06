import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getFollowup } from '../../../../stores/followups'
import { followupAttachmentsDir } from '../../../../utils/attachments'

const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const name = getRouterParam(event, 'name') ?? ''
  const row = getFollowup(id)
  const attachment = row?.attachments.find(a => a.name === name)
  const path = attachment && join(followupAttachmentsDir(id), attachment.name)
  if (!attachment || !path || !existsSync(path)) {
    throw createError({ statusCode: 404, statusMessage: 'Attachment not found' })
  }
  // Uploaders pick the type: only raster images are ever rendered by the browser, anything else is a download.
  const type = attachment.type.split(/[;,]/)[0]!.trim().toLowerCase()
  const image = INLINE_IMAGE_TYPES.has(type)
  setHeader(event, 'content-type', image ? type : 'application/octet-stream')
  setHeader(event, 'x-content-type-options', 'nosniff')
  if (!image) setHeader(event, 'content-disposition', `attachment; filename="${attachment.name}"`)
  setHeader(event, 'content-length', attachment.size)
  setHeader(event, 'cache-control', 'private, max-age=3600')
  return sendStream(event, createReadStream(path))
})
