import type { z } from 'zod'
import type { Trigger } from '../../db/schema'
import { jiraSource } from './jira'

// Pluggable trigger sources. The built-in sources (schedule, github, manual)
// predate this registry and keep their dedicated columns + code paths; every
// NEW source lives here instead, keeping its settings in `triggers.config` and
// its runtime memory in `triggers.state` (both JSON, so no schema migration).
//
// Adding a source means: one definition file in this folder (registered in
// TRIGGER_SOURCES below), one form section in TriggerCreateModal.vue, one
// TRIGGER_SOURCE_META entry in app/utils/dashboard.ts, and, if it needs
// credentials, a Settings panel. The triggers API validates `config` against
// the source's schema, toSummaries renders `eventLabel`, and the generic
// poller plugin (server/plugins/trigger-poller.ts) drives `poll`.

// One firing produced by a poll: the run inputs (the unified contract: event,
// identifier, title, body, url) and an optional branch override.
export interface PollMatch {
  inputs: Record<string, string>
  branch?: string | null
}

export interface PollResult {
  matches: PollMatch[]
  // The trigger's next `state`; persisted by the poller when it changed.
  state: Record<string, unknown>
}

// S stays a string literal ('jira') so the API's zod union discriminates on it
// and DB writes keep the enum type.
export interface TriggerSourceDef<S extends string = string> {
  source: S
  // Validates `config` on create/edit. z.ZodType would erase the input type,
  // so definitions expose their concrete schema and the API safeParses it.
  configSchema: z.ZodType<Record<string, unknown>, Record<string, unknown>>
  // Compact description for trigger rows, e.g. 'On SHOP · label "knecht"'.
  eventLabel(config: Record<string, unknown>): string
  // Seed `state` when the trigger is created or its config edited, so items
  // already matching at that moment don't fire retroactively.
  init(config: Record<string, unknown>): Promise<Record<string, unknown>>
  // Diff the remote state against `trigger.state` and return what fires now.
  // Runs every poller tick; a throw skips this tick and retries on the next.
  poll(trigger: Trigger): Promise<PollResult>
}

export const TRIGGER_SOURCES = [jiraSource] as const

export function getTriggerSource(source: string): TriggerSourceDef | undefined {
  return TRIGGER_SOURCES.find(def => def.source === source)
}
