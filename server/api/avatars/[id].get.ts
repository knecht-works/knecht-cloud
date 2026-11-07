import { getMemberById } from '../../stores/members'

export default defineEventHandler((event) => {
  const image = getMemberById(Number(getRouterParam(event, 'id')))?.avatarImage
  const match = image && /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(image)
  if (!match) {
    throw createError({ statusCode: 404, statusMessage: 'No picture.' })
  }
  setResponseHeader(event, 'content-type', match[1]!)
  // The URL carries a version, so a new picture gets a new URL.
  setResponseHeader(event, 'cache-control', 'private, max-age=31536000, immutable')
  return Buffer.from(match[2]!, 'base64')
})
