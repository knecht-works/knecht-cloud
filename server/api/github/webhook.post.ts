import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { githubAppCredentials } from '../../utils/github-credentials'
import { fireTrigger } from '../../utils/triggers'
import { githubObject, matchGithubEvent, verifyGithubSignature, type GithubPayload } from '../../utils/github-webhook'
import { handleMention } from '../../utils/mentions'
import { syncObjectStatus } from '../../utils/sessions'
import { tryParseJson } from '../../utils/json'

// No session gate: GitHub authenticates with the HMAC signature over the raw body.
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

  const githubId = payload.repository?.id
  const project = githubId
    ? db.select().from(schema.projects).where(eq(schema.projects.githubId, githubId)).get()
    : undefined
  if (!project) {
    console.log(`github webhook: ${delivered} from ${payload.repository?.full_name ?? 'unknown repo'} → no matching project`)
    return { ok: true, skipped: 'no matching project' }
  }

  if (delivered === 'issue_comment') {
    const outcome = await handleMention(project, payload)
    console.log(`github webhook: issue_comment from ${project.fullName} → ${outcome}`)
    return { ok: true, outcome }
  }

  const action = payload.action ?? ''
  if ((delivered === 'issues' || delivered === 'pull_request') && (action === 'closed' || action === 'reopened')) {
    const object = githubObject(delivered === 'issues' ? 'issue' : 'pull_request', payload)
    if (object) syncObjectStatus(project.id, object, action === 'closed' ? 'closed' : 'open')
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
      object: match.object,
    }))
  }

  console.log(`github webhook: ${delivered}${payload.action ? `/${payload.action}` : ''} from ${project.fullName} → ${runIds.length ? `run(s) ${runIds.join(', ')}` : 'no trigger matched'}`)
  return { ok: true, runIds }
})
