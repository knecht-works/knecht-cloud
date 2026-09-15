import { eq } from 'drizzle-orm'
import { db, schema } from '../../db'
import { addCommentReaction, addIssueLabels, createIssueComment, listRepoLabels, removeIssueLabel } from '../../utils/github-app'
import { githubAppCredentials } from '../../utils/github-credentials'
import { tryParseJson } from '../../utils/json'
import { isMember } from '../../utils/members'
import { verifySha256Signature } from '../../utils/signature'
import type { Integration, WebhookComment, WebhookDelivery } from '../types'
import { githubEventLabel, githubObject, githubTriggerConfigSchema, matchGithubEvent, type GithubPayload, type GithubTriggerConfig } from './webhook'

const MENTION_HANDLE = 'knecht-works'

let cachedSlug: string | null | undefined
function appSlug(): string | null {
  if (cachedSlug !== undefined) return cachedSlug
  cachedSlug = db.select({ slug: schema.githubApp.slug }).from(schema.githubApp).where(eq(schema.githubApp.id, 1)).get()?.slug ?? null
  return cachedSlug
}

function mentionsKnecht(body: string): boolean {
  const handles = [MENTION_HANDLE, appSlug()].filter((h): h is string => !!h)
  return handles.some(h => new RegExp(`@${h}\\b`, 'i').test(body))
}

function parseComment(payload: GithubPayload): WebhookComment | undefined {
  if (payload.action !== 'created') return undefined
  // A comment on a pull request arrives as issue_comment: the subject is payload.issue either way.
  const object = githubObject(payload.issue?.pull_request ? 'pull_request' : 'issue', payload.issue)
  const login = (payload.comment?.user?.login ?? '').toLowerCase()
  if (!object || !login) return undefined
  const body = payload.comment?.body ?? ''
  return {
    id: String(payload.comment?.id ?? ''),
    author: { id: login, name: login },
    body,
    // Includes Knecht's own replies: the guaranteed reply would otherwise loop.
    fromSelf: payload.comment?.user?.type === 'Bot',
    mentionsKnecht: mentionsKnecht(body),
    object,
  }
}

export const github: Integration = {
  id: 'github',

  isConfigured: () => !!githubAppCredentials()?.webhookSecret,

  trigger: {
    configSchema: githubTriggerConfigSchema,
    eventLabel: config => githubEventLabel(config as GithubTriggerConfig),
  },

  webhook: {
    verify(raw, header) {
      const secret = githubAppCredentials()?.webhookSecret
      return !!secret && verifySha256Signature(raw, secret, header('x-hub-signature-256') ?? '')
    },

    async parse(raw, header) {
      const name = header('x-github-event') ?? ''
      const payload = (tryParseJson(raw) ?? {}) as GithubPayload
      const githubId = payload.repository?.id
      const project = githubId
        ? db.select().from(schema.projects).where(eq(schema.projects.githubId, githubId)).get()
        : undefined
      if (!project) return null

      const action = payload.action ?? ''
      const delivery: WebhookDelivery = {
        project,
        summary: `${name}${action ? `/${action}` : ''}`,
      }
      if (name === 'issue_comment') {
        delivery.comment = parseComment(payload)
        return delivery
      }
      if ((name === 'issues' || name === 'pull_request') && (action === 'closed' || action === 'reopened')) {
        const object = name === 'issues' ? githubObject('issue', payload.issue) : githubObject('pull_request', payload.pull_request)
        if (object) delivery.statusChange = { object, status: action === 'closed' ? 'closed' : 'open' }
      }
      delivery.event = { name, payload }
      return delivery
    },

    match(trigger, delivery) {
      if (!delivery.event) return null
      return matchGithubEvent(trigger.config as GithubTriggerConfig, delivery.event.name, delivery.event.payload as GithubPayload)
    },
  },

  objects: {
    kinds: ['issue', 'pull_request'],
    describe: object => `${object.kind === 'issue' ? 'issue' : 'pull request'} #${object.key}`,
  },

  mentions: {
    allowsAuthor: author => isMember(author.id),
    async acknowledge(project, comment) {
      if (comment.id) await addCommentReaction(project.owner, project.name, Number(comment.id), 'eyes')
    },
  },

  capabilities: {
    comment: (project, object, body) => createIssueComment(project.owner, project.name, Number(object.key), body),

    async label(project, object, add, remove) {
      if (add.length) {
        // Only labels that already exist in the repo may be applied: Knecht
        // never invents labels.
        const existing = new Set(await listRepoLabels(project.owner, project.name))
        const unknown = add.filter(l => !existing.has(l))
        if (unknown.length) {
          throw new Error(`these labels do not exist in the repo and Knecht never creates labels: ${unknown.join(', ')}. Existing labels: ${[...existing].join(', ') || '(none)'}`)
        }
        await addIssueLabels(project.owner, project.name, Number(object.key), add)
      }
      for (const label of remove) {
        await removeIssueLabel(project.owner, project.name, Number(object.key), label)
      }
      return [add.length ? `added ${add.join(', ')}` : '', remove.length ? `removed ${remove.join(', ')}` : ''].filter(Boolean).join('; ')
    },
  },
}
