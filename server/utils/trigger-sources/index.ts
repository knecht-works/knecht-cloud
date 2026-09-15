import type { z } from 'zod'
import type { Trigger } from '../../db/schema'
import type { TriggerInputs } from '../inputs'
import { jiraSource } from './jira'

// A new source also needs a form section in KTriggerCreateModal.vue and a
// TRIGGER_SOURCE_META entry in app/utils/dashboard.ts.

export interface PollMatch {
  inputs: TriggerInputs
  branch?: string | null
}

export interface PollResult {
  matches: PollMatch[]
  state: Record<string, unknown>
}

// S stays a string literal so the API's zod union discriminates on it.
export interface TriggerSourceDef<S extends string = string> {
  source: S
  configSchema: z.ZodType<Record<string, unknown>, Record<string, unknown>>
  eventLabel(config: Record<string, unknown>): string
  // Seeds `state` so items already matching at setup do not fire retroactively.
  init(config: Record<string, unknown>): Promise<Record<string, unknown>>
  poll(trigger: Trigger): Promise<PollResult>
}

export const TRIGGER_SOURCES = [jiraSource] as const

export function getTriggerSource(source: string): TriggerSourceDef | undefined {
  return TRIGGER_SOURCES.find(def => def.source === source)
}
