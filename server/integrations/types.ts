import type { z } from 'zod'
import type { Project, Run, Session, Trigger } from '../db/schema'
import type { IntegrationId, ObjectKind } from '../../shared/utils/integrations'
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

export interface Integration {
  id: IntegrationId
  isConfigured(): boolean

  trigger: {
    configSchema: z.ZodType<Record<string, unknown>>
    eventLabel(config: Record<string, unknown>): string
    validateProjects?(projectIds: number[]): string | null
  }

  webhook: {
    verify(raw: string, headers: WebhookHeaders): boolean
    // null: the delivery belongs to no project of this instance.
    parse(raw: string, headers: WebhookHeaders): Promise<WebhookDelivery | null>
    match(trigger: Trigger, delivery: WebhookDelivery): TriggerMatch | null
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

  onRunFinished?(project: Project, session: Session, run: Run, status: 'success' | 'failed'): Promise<void>
}
