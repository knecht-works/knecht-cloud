import type { z } from 'zod'
import type { Trigger } from '../../db/schema'

// A new source also needs a form section in KTriggerCreateModal.vue and a
// TRIGGER_SOURCE_META entry in app/utils/dashboard.ts.

// S stays a string literal so the API's zod union discriminates on it.
export interface TriggerSourceDef<S extends string = string> {
  source: S
  configSchema: z.ZodType<Record<string, unknown>, Record<string, unknown>>
  eventLabel(trigger: Trigger): string
}

export const TRIGGER_SOURCES: readonly TriggerSourceDef[] = []

export function getTriggerSource(source: string): TriggerSourceDef | undefined {
  return TRIGGER_SOURCES.find(def => def.source === source)
}
