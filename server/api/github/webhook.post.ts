import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { githubAppCredentials } from '../../utils/github-credentials'
import { fireTrigger } from '../../utils/triggers'
import { matchGithubEvent, verifyGithubSignature, type GithubPayload } from '../../utils/github-webhook'
import { tryParseJson } from '../../utils/json'

// POST /api/github/webhook → the central GitHub App webhook. GitHub delivers
// every subscribed event of every repo the app is installed on to this one
// endpoint, so triggers need no per-repo webhook setup. Exempt from the session
// gate (server/middleware/auth.ts); GitHub authenticates via the HMAC signature
// over the raw body, checked against the app's webhook secret. The delivery's
// repo picks the project; every active github trigger listening for the event
// (and whose filters match) fires against that project only.
export default defineEventHandler(async (event) => {
  const secret = githubAppCredentials()?.webhookSecret
  if (!secret) {
    throw createError({ statusCode: 404, statusMessage: 'App webhook not configured' })
  }

  const raw = (await readRawBody(event, 'utf8')) ?? ''
  const provided = getHeader(event, 'x-hub-signature-256') ?? ''
  if (!verifyGithubSignature(raw, secret, provided)) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  const delivered = getHeader(event, 'x-github-event') ?? ''
  const payload = (tryParseJson(raw) ?? {}) as GithubPayload

  // Map the delivery to a connected project; deliveries from repos the app is
  // installed on but that aren't connected (and app-level events like 'ping'
  // or 'installation') are acknowledged and dropped.
  const githubId = payload.repository?.id
  const project = githubId
    ? db.select().from(schema.projects).where(eq(schema.projects.githubId, githubId)).get()
    : undefined
  if (!project) {
    console.log(`github webhook: ${delivered} from ${payload.repository?.full_name ?? 'unknown repo'} → no matching project`)
    return { ok: true, skipped: 'no matching project' }
  }

  const candidates = db
    .select()
    .from(schema.triggers)
    .where(and(eq(schema.triggers.source, 'github'), eq(schema.triggers.active, true)))
    .all()

  const runIds: number[] = []
  for (const trigger of candidates) {
    if (!trigger.projectIds.includes(project.id)) continue
    const match = matchGithubEvent(trigger, delivered, payload)
    if (!match) continue
    runIds.push(...fireTrigger(trigger, {
      projectIds: [project.id],
      branch: match.branch,
      inputs: match.inputs,
    }))
  }

  console.log(`github webhook: ${delivered}${payload.action ? `/${payload.action}` : ''} from ${project.fullName} → ${runIds.length ? `run(s) ${runIds.join(', ')}` : 'no trigger matched'}`)
  return { ok: true, runIds }
})
