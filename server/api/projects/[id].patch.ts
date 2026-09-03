import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { AGENT_INSTRUCTIONS_MAX } from '#shared/utils/settings-limits'
import { DDEV_PHP_VERSIONS, NODE_VERSION_PATTERN } from '#shared/utils/env-spec'
import { PREVIEW_FORWARD_PORT } from '#shared/utils/preview-host'
import { db, schema } from '../../db'

// PATCH /api/projects/:id → update the editable per-project config.
const bodySchema = z.object({
  envVars: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .optional(),
  // The branch runs check out and open PRs against. New runs pick it up on
  // their next checkout; the shared base clone just fetches the new branch.
  defaultBranch: z.string().min(1).optional(),
  // How preview URLs reach the browser (see server/db/schema.ts). Applies to
  // runs started after the change; existing runs keep their pinned mode.
  urlMode: z.enum(['env', 'rewrite']).optional(),
  // Project-relative folders whose contents persist across runs (see
  // server/db/schema.ts). Normalized here; a path that escapes the project
  // root or targets git/ddev internals rejects the whole request.
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
  // Project-level agent instructions, layered on top of the instance ones
  // (materialized by server/workflows/actions/ai.ts).
  agentInstructions: z.string().max(AGENT_INSTRUCTIONS_MAX).optional(),
  // Commands that run after `ddev start` + DB import on a session's first
  // boot, before any workflow-specific ddev-start commands: how THIS project
  // boots, so one generic workflow serves differently-booting projects.
  bootCommands: z.string().max(4000).optional(),
  // Mentions (ADR 0007): the @-mention switch and the workflow that boots a
  // session when a mentioned object has none yet. Null clears the starter.
  mentionsEnabled: z.boolean().optional(),
  starterWorkflowId: z.number().int().nullable().optional(),
  // Environment overrides for repos without their own ddev config
  // (shared/utils/env-spec.ts); null clears one back to the detected value.
  // Ignored at boot for repos that ship a ddev config.
  phpVersion: z.enum(DDEV_PHP_VERSIONS).nullable().optional(),
  nodeVersion: z.string().regex(NODE_VERSION_PATTERN, 'Node version is a major or major.minor').nullable().optional(),
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
  // A dev server is only useful with the port it listens on: the port is
  // what makes the generated environment previewable at all.
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
