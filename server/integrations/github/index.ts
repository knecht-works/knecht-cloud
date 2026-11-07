import { getGithubAppRow } from '../../stores/github-app'
import { getProjectByRepo } from '../../stores/projects'
import { addCommentReaction, addIssueLabels, createIssueComment, listRepoLabels, removeIssueLabel } from '../../utils/github-app'
import { githubAppCredentials } from '../../utils/github-credentials'
import { tryParseJson } from '../../utils/json'
import { isMember } from '../../stores/members'
import { verifySha256Signature } from '../../utils/signature'
import type { Integration, WebhookComment, WebhookDelivery } from '../types'
import type { TriggerConfig } from '../../../shared/utils/trigger-form'
import { githubObject, matchGithubEvent, type GithubPayload } from './webhook'
import { githubSnapshot } from './snapshot'

const MENTION_HANDLE = 'knecht-works'

let cachedSlug: string | null | undefined
function appSlug(): string | null {
  if (cachedSlug !== undefined) return cachedSlug
  cachedSlug = getGithubAppRow()?.slug ?? null
  return cachedSlug
}

function mentionsKnecht(body: string): boolean {
  const handles = [MENTION_HANDLE, appSlug()].filter((h): h is string => !!h)
  return handles.some(h => new RegExp(`@${RegExp.escape(h)}\\b`, 'i').test(body))
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
  name: 'GitHub',

  isConfigured: () => !!githubAppCredentials()?.webhookSecret,

  webhook: {
    verify(raw, header) {
      const secret = githubAppCredentials()?.webhookSecret
      return !!secret && verifySha256Signature(raw, secret, header('x-hub-signature-256') ?? '')
    },

    async parse(raw, header) {
      const name = header('x-github-event') ?? ''
      const payload = (tryParseJson(raw) ?? {}) as GithubPayload
      const repoId = payload.repository?.id
      const project = repoId ? getProjectByRepo('github', String(repoId)) : undefined
      if (!project) return null

      const action = payload.action ?? ''
      const delivery: WebhookDelivery = {
        project,
        summary: `${name}${action ? `/${action}` : ''}`,
      }
      const subject = name === 'pull_request' ? githubObject('pull_request', payload.pull_request) : githubObject(payload.issue?.pull_request ? 'pull_request' : 'issue', payload.issue)
      if (subject && payload.sender?.login !== `${appSlug()}[bot]`) delivery.object = subject
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
      return matchGithubEvent(trigger.config as unknown as TriggerConfig, delivery.event.name, delivery.event.payload as GithubPayload)
    },
  },

  objects: {
    kinds: ['issue', 'pull_request'],
    describe: object => `${object.kind === 'issue' ? 'issue' : 'pull request'} #${object.key}`,
    context: githubSnapshot,
    // Issues and pull requests share their numbers, and the issues API serves both.
    find: (_project, key) => {
      const number = /^#?(\d+)$/.exec(key)?.[1]
      return number ? { integration: 'github', kind: 'issue', key: number } : null
    },
  },

  mentions: {
    allowsAuthor: author => isMember(author.id),
    async acknowledge(project, comment) {
      if (comment.id) await addCommentReaction(project.owner, project.name, Number(comment.id), 'eyes')
    },
  },

  capabilities: {
    comment: (project, object, body) => createIssueComment(project.owner, project.name, Number(object.key), body),

    labels: {
      list: project => listRepoLabels(project.owner, project.name),
      async apply(project, object, add, remove) {
        if (add.length) await addIssueLabels(project.owner, project.name, Number(object.key), add)
        for (const label of remove) {
          await removeIssueLabel(project.owner, project.name, Number(object.key), label)
        }
      },
    },
  },
}
