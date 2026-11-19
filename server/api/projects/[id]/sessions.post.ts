import { z } from 'zod'
import { requireProject } from '../../../stores/projects'
import { resolveSession } from '../../../utils/sessions'
import { queueSessionRun } from '../../../utils/session-runs'
import { defineEventHandler, readBody } from 'h3'
import { requireIntParam, zodBadRequest } from '#server/utils/http'

const bodySchema = z.object({
  branch: z.string().min(1).optional(),
  preview: z.boolean().default(false),
})

export default defineEventHandler(async (event) => {
  const project = requireProject(requireIntParam(event))
  const result = bodySchema.safeParse(await readBody(event) ?? {})
  if (!result.success) zodBadRequest(result.error, 'Invalid session request')

  const session = resolveSession(project, null, result.data.branch ?? null)
  return queueSessionRun(project, session, result.data.preview)
})
