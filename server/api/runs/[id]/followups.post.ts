import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../../db'
import { startFollowup } from '../../../daemon/followups'
import { requireSession } from '../../../utils/entities'
import { dispatchRuns } from '../../../daemon/dispatcher'
import { sessionHasActiveWork } from '../../../utils/sessions'
import { emitFollowup, emitItem } from '../../../utils/transcript'
import { CLEAR_COMMAND, PR_COMMAND, PUBLISH_FOLLOWUP_PROMPT } from '../../../../shared/utils/followup'
import { MODEL_NAME_RE } from '../../../../shared/utils/ai'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, saveAttachments, type UploadedFile } from '../../../utils/attachments'

const bodySchema = z.object({
  prompt: z.string().trim().min(1),
  model: z.string().trim().regex(MODEL_NAME_RE).optional(),
})

export default defineEventHandler(async (event) => {
  const id = requireIntParam(event)
  const run = requireRun(id)
  const session = requireSession(run.sessionId)

  const { fields, files } = await readFollowupBody(event)
  const result = bodySchema.safeParse(fields)
  if (!result.success) {
    zodBadRequest(result.error, 'Invalid follow-up')
  }
  if (files.length > MAX_ATTACHMENTS) {
    throw createError({ statusCode: 400, statusMessage: `At most ${MAX_ATTACHMENTS} files per message` })
  }
  if (files.some(f => f.data.length > MAX_ATTACHMENT_BYTES)) {
    throw createError({ statusCode: 400, statusMessage: `Each file must be ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB or smaller` })
  }

  if (run.status === 'cancelled') {
    throw createError({ statusCode: 409, statusMessage: 'A cancelled run accepts no follow-ups. Retry it first.' })
  }
  // A queued or running run boots the environment itself; the follow-up waits behind it.
  const pending = run.status === 'queued' || run.status === 'running'
  if (!pending && session.envState === 'down') {
    throw createError({ statusCode: 409, statusMessage: 'The session\'s environment is gone. Run the workflow again.' })
  }
  const busy = pending || sessionHasActiveWork(session.id)
  const { user } = await requireUserSession(event)

  if (result.data.prompt === CLEAR_COMMAND) {
    if (busy) throw createError({ statusCode: 409, statusMessage: 'Wait for the running turn to finish before clearing.' })
    // No agent involved: the next turn simply starts a new agent session.
    const now = new Date()
    const followup = db.insert(schema.followups).values({
      sessionId: session.id,
      runId: id,
      prompt: CLEAR_COMMAND,
      requestedBy: user.login,
      status: 'success',
      startedAt: now,
      finishedAt: now,
    }).returning().get()
    db.update(schema.sessions).set({ agentSessionId: null, agentHandover: null }).where(eq(schema.sessions.id, session.id)).run()
    const item = db.insert(schema.agentItems).values({
      sessionId: session.id,
      followupId: followup.id,
      seq: 0,
      type: 'divider',
      text: 'New conversation. The agent no longer knows the messages above.',
    }).returning().get()
    emitFollowup(followup.id)
    emitItem(item)
    return followup
  }

  const inserted = db.insert(schema.followups).values({
    sessionId: session.id,
    runId: id,
    prompt: result.data.prompt === PR_COMMAND ? PUBLISH_FOLLOWUP_PROMPT : result.data.prompt,
    model: result.data.model ?? null,
    requestedBy: user.login,
  }).returning().get()
  const attachments = saveAttachments(inserted.id, files)
  const followup = attachments.length
    ? db.update(schema.followups).set({ attachments }).where(eq(schema.followups.id, inserted.id)).returning().get()!
    : inserted
  emitFollowup(followup.id)

  if (session.envState === 'up' && !busy) void startFollowup(followup.id)
  else dispatchRuns()

  return followup
})

// JSON from the dashboard's plain sends, multipart once files ride along.
async function readFollowupBody(event: Parameters<typeof readBody>[0]): Promise<{ fields: Record<string, unknown>, files: UploadedFile[] }> {
  if (!(getHeader(event, 'content-type') ?? '').startsWith('multipart/form-data')) {
    return { fields: (await readBody(event)) ?? {}, files: [] }
  }
  const fields: Record<string, unknown> = {}
  const files: UploadedFile[] = []
  for (const part of (await readMultipartFormData(event)) ?? []) {
    if (part.filename) files.push({ filename: part.filename, type: part.type ?? '', data: part.data })
    else if (part.name) fields[part.name] = part.data.toString()
  }
  return { fields, files }
}
