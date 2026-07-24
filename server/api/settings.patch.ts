import { z } from 'zod'
import { AI_PROVIDERS, type AiProviderId } from '#shared/utils/ai'
import { publicSettings, updateSettings } from '../utils/settings'
import { encrypt } from '../utils/crypto'

// PATCH /api/settings → update the tunable settings. Each field is optional so
// the UI can send only what changed; values are bounded so a stray input can't
// disable safety (e.g. an unbounded idle timeout) by accident. `aiKey` is
// write-only: it is encrypted at rest and never returned; null removes the
// stored key.
const bodySchema = z.object({
  idleStopMinutes: z.number().int().min(1).max(10080).optional(),
  previewRetentionDays: z.number().int().min(0).max(365).optional(),
  archiveRetentionDays: z.number().int().min(0).max(3650).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(20).optional(),
  aiProvider: z.enum(AI_PROVIDERS.map(p => p.id) as [AiProviderId, ...AiProviderId[]]).optional(),
  aiKey: z.string().min(1).max(500).nullable().optional(),
  aiModel: z.string().min(1).max(200).optional(),
  // The charset excludes whitespace/quotes so the value can be spliced
  // verbatim into the ssh command line (utils/ssh.ts sshTerminalCommand).
  sshTarget: z.string().trim().regex(/^[A-Za-z0-9._@-]+$/).max(200).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const result = bodySchema.safeParse(await readBody(event))
  if (!result.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid settings' })
  }
  const { aiKey, ...patch } = result.data
  return publicSettings(updateSettings({
    ...patch,
    ...(aiKey !== undefined ? { aiKeyEnc: aiKey === null ? null : encrypt(aiKey) } : {}),
  }))
})
