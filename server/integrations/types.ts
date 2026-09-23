import type { Project, Trigger } from '../db/schema'
import type { ConnectionFormDef } from '../../shared/utils/connection-form'
import type { IntegrationId, ObjectKind } from '../../shared/utils/integrations'
import type { TriggerFormDef } from '../../shared/utils/trigger-form'
import type { TriggerInputs } from '../utils/inputs'
import type { SessionObject } from '../utils/sessions'
import type { ConnectionStore } from './connections'

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
  actor?: CommentAuthor | null
  // Null when the tool sends one delivery per action; see `objectVersion`.
  version: string | null
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
    // Remote option lists of the form, by name: `/api/integrations/<id>/options/<name>?project=<key>`.
    // The key is the project's link key, or the repository's full name where projects are not linked.
    options?: Record<string, (projectKey: string) => Promise<string[]>>
  }

  // Integrations an admin connects with credentials on the settings page. Their
  // deliveries are recorded there, because these tools show no delivery log.
  connection?: {
    form: ConnectionFormDef
    store: ConnectionStore
    verify(values: Record<string, string>): Promise<{ displayName: string, accountId: string }>
    onChange?(): void
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
    labels?: {
      // Knecht never creates labels: only names on this list are applied.
      list(project: Project, object: SessionObject): Promise<string[]>
      apply(project: Project, object: SessionObject, add: string[], remove: string[]): Promise<void>
    }
    statuses?: {
      // What the object can move to right now, each with the call that moves it there.
      targets(project: Project, object: SessionObject): Promise<{ name: string, apply(): Promise<void> }[]>
    }
    // The assignee shows whether Knecht is working on the object: taken while a session has
    // active work, handed back to whoever gave it to Knecht once it is idle.
    assignee?: {
      // Answers who held the object before, when that was somebody other than Knecht.
      take(project: Project, object: SessionObject): Promise<CommentAuthor | null>
      // Falls back on its own when `to` is null or cannot take the object; answers what it did.
      handBack(project: Project, object: SessionObject, to: CommentAuthor | null): Promise<string>
    }
  }

  // For integrations whose objects do not show the pull request themselves: the run's
  // result is commented on the object, worded "for this <noun>".
  runResult?: { noun: string }
}
