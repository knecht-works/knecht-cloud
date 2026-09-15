import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { AGENT_INSTRUCTIONS_MAX } from '#shared/utils/settings-limits'
import { DDEV_PHP_VERSIONS, NODE_VERSION_PATTERN, PACKAGE_MANAGERS } from '#shared/utils/env-spec'
import { PREVIEW_FORWARD_PORT } from '#shared/utils/preview-host'
import { db, schema } from '../../db'

const bodySchema = z.object({
  envVars: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .optional(),
  defaultBranch: z.string().min(1).optional(),
  urlMode: z.enum(['env', 'rewrite']).optional(),
  sharedFolders: z
    .array(z.string())
    .max(20)
    .transform((folders, ctx) => {
      const normalized = folders.map(normalizeSharedFolder)
      if (normalized.includes(null)) {
        ctx.addIssue({ code: 'custom', message: 'Invalid folder path' })
        return z.NEVER
      }
      return [...new Set(normalized as string[])]
    })
    .optional(),
  agentInstructions: z.string().max(AGENT_INSTRUCTIONS_MAX).optional(),
  bootCommands: z.string().max(4000).optional(),
  mentionsEnabled: z.boolean().optional(),
  starterWorkflowId: z.number().int().nullable().optional(),
  phpVersion: z.enum(DDEV_PHP_VERSIONS).nullable().optional(),
  nodeVersion: z.string().regex(NODE_VERSION_PATTERN, 'Node version is a major or major.minor').nullable().optional(),
  packageManager: z.enum(PACKAGE_MANAGERS).nullable().optional(),
  devServer: z.string().trim().max(500).transform(v => v || null).nullable().optional(),
  previewPort: z.number().int().min(1).max(65535).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const project = requireProject(id)

  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid project config' })
  }
  const next = { ...project, ...result.data }
  if (next.devServer && next.previewPort == null) {
    throw createError({ statusCode: 400, statusMessage: 'A dev server needs a preview port' })
  }
  // The forwarder's own port: it would forward to itself.
  if (next.previewPort === PREVIEW_FORWARD_PORT) {
    throw createError({ statusCode: 400, statusMessage: `Port ${PREVIEW_FORWARD_PORT} is reserved for the preview` })
  }

  const updated = db
    .update(schema.projects)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(schema.projects.id, id))
    .returning()
    .get()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  return updated
})
