import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../../db'
import { followupAttachmentsDir } from '../../../../utils/attachments'

export default defineEventHandler((event) => {
  const id = requireIntParam(event)
  const name = getRouterParam(event, 'name') ?? ''
  const row = db.select({ attachments: schema.followups.attachments }).from(schema.followups).where(eq(schema.followups.id, id)).get()
  const attachment = row?.attachments.find(a => a.name === name)
  const path = attachment && join(followupAttachmentsDir(id), attachment.name)
  if (!attachment || !path || !existsSync(path)) {
    throw createError({ statusCode: 404, statusMessage: 'Attachment not found' })
  }
  // Uploaders pick the type: only images are ever rendered by the browser, anything else is a download.
  const image = attachment.type.startsWith('image/') && !attachment.type.includes('svg')
  setHeader(event, 'content-type', image ? attachment.type : 'application/octet-stream')
  setHeader(event, 'x-content-type-options', 'nosniff')
  if (!image) setHeader(event, 'content-disposition', `attachment; filename="${attachment.name}"`)
  setHeader(event, 'content-length', attachment.size)
  setHeader(event, 'cache-control', 'private, max-age=3600')
  return sendStream(event, createReadStream(path))
})
