import type { Project, Trigger } from '../db/schema'
import type { IntegrationId, ObjectKind } from '../../shared/utils/integrations'
import type { TriggerFormDef } from '../../shared/utils/trigger-form'
import type { TriggerInputs } from '../utils/inputs'
import type { SessionObject } from '../utils/sessions'

export type WebhookHeaders = (name: string) => string | undefined

export interface CommentAuthor {
  id: string
  // What the tool shows: the value that ends up in followups.requestedBy.
  name: string
}

export interface WebhookComment {
  id: string
  author: CommentAuthor
  body: string
  // Written by Knecht's own account (or any bot): never a mention, would otherwise loop.
  fromSelf: boolean
  mentionsKnecht: boolean
  object: SessionObject
}

// One delivery can carry several things: an `issues closed` event is both a
// status change and a trigger event.
export interface WebhookDelivery {
  project: Project
  comment?: WebhookComment
  statusChange?: { object: SessionObject, status: 'open' | 'closed' }
  event?: { name: string, payload: unknown }
  summary: string
}

export type DeliveryRecord
  = { ok: true, summary: string }
    | { ok: false, reason: 'signature' | 'empty-body' | 'no-project' }

export interface TriggerMatch {
  branch: string | null
  inputs: TriggerInputs
  object: SessionObject | null
}

export interface LinkTarget {
  key: string
  name: string
}

export interface Integration {
  id: IntegrationId
  name: string
  isConfigured(): boolean

  trigger: {
    form: TriggerFormDef
  }

  // Integrations whose events come from a container that must be mapped to
  // a project first (a Jira project). Their triggers only take linked
  // projects; GitHub needs none because the repository is the project.
  link?: {
    label: string
    listTargets(): Promise<LinkTarget[]>
  }

  webhook: {
    verify(raw: string, headers: WebhookHeaders): boolean
    // null: the delivery belongs to no project of this instance.
    parse(raw: string, headers: WebhookHeaders): Promise<WebhookDelivery | null>
    match(trigger: Trigger, delivery: WebhookDelivery): TriggerMatch | null | Promise<TriggerMatch | null>
    // For integrations whose admin UI shows no delivery log.
    record?(result: DeliveryRecord): void
  }

  objects: {
    kinds: readonly ObjectKind[]
    describe(object: SessionObject): string
    // Live state as markdown for the agent (`knecht-object`): description, facts, newest comments.
    context(project: Project, object: SessionObject): Promise<string>
  }

  mentions: {
    allowsAuthor(author: CommentAuthor): boolean
    acknowledge?(project: Project, comment: WebhookComment): Promise<void>
  }

  capabilities: {
    comment(project: Project, object: SessionObject, body: string): Promise<{ url?: string }>
    label?(project: Project, object: SessionObject, add: string[], remove: string[]): Promise<string>
    setStatus?(project: Project, object: SessionObject, status: string): Promise<string>
  }

  // For integrations whose objects do not show the pull request themselves: the run's
  // result is commented on the object, worded "for this <noun>".
  runResult?: { noun: string }
}
