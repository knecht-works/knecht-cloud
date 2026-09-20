import { z } from 'zod'
import { listPlaneStates, planeProjectByIdentifier } from '../../integrations/plane/api'
import { isPlaneConfigured } from '../../integrations/plane/credentials'

export default defineEventHandler(async (event) => {
  if (!isPlaneConfigured()) {
    throw createError({ statusCode: 400, statusMessage: 'Plane is not connected' })
  }
  const project = z.string().min(1).safeParse(getQuery(event).project)
  if (!project.success) {
    throw createError({ statusCode: 400, statusMessage: 'Missing project identifier' })
  }
  try {
    return (await listPlaneStates((await planeProjectByIdentifier(project.data)).id)).map(s => s.name)
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: 'Could not reach Plane' })
  }
})
