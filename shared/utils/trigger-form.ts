// An integration describes its trigger as data. The config schema, the event
// label and the trigger dialog all derive from it; only the matcher is code.

export interface TriggerValueInput {
  placeholder?: string
  default?: string
  options?: { label: string, value: string, summary?: string }[]
  optionsHeading?: string
  optionsUrl?: string
  remoteHeading?: string
  // Only listed values can be picked: nothing typed, and on a filter no patterns.
  listedOnly?: boolean
}

export interface TriggerEventDef {
  type: string
  label: string
  summary: string
  hint?: string
  value?: TriggerValueInput
  default?: boolean
}

export interface TriggerFilterDef {
  key: string
  label: string
  placeholder?: string
  // Without `listedOnly` the options and `optionsUrl` are suggestions: patterns like `kn*` can still be typed.
  options?: { label: string, value: string }[]
  optionsHeading?: string
  optionsUrl?: string
  remoteHeading?: string
  listedOnly?: boolean
}

// Where the object has to be (a tracker status). The events in `requiredBy` take their target from it.
export interface TriggerScopeDef extends TriggerValueInput {
  label: string
  requiredBy: string[]
}

export interface TriggerKindDef {
  kind: string
  label: string
  events: TriggerEventDef[]
  filters: TriggerFilterDef[]
  scope?: TriggerScopeDef
}

// One entry per object kind; several kinds show as tabs.
export type TriggerFormDef = TriggerKindDef[]

export interface TriggerEventConfig {
  type: string
  values?: string[]
}

export const TRIGGER_CONDITION_OPS = ['is', 'is-not'] as const
export type TriggerConditionOp = typeof TRIGGER_CONDITION_OPS[number]

export interface TriggerCondition {
  field: string
  op: TriggerConditionOp
  values: string[]
}

// One event fires the trigger, and only when every condition holds and the object is in the scope.
export interface TriggerConfig {
  kind: string
  event: TriggerEventConfig
  conditions: TriggerCondition[]
  scope?: { values: string[] }
}

export function defaultTriggerConfig(form: TriggerFormDef, kind = form[0]!.kind): TriggerConfig {
  const def = form.find(k => k.kind === kind) ?? form[0]!
  const e = def.events.find(e => e.default) ?? def.events[0]!
  return {
    kind: def.kind,
    event: e.value ? { type: e.type, values: [e.value.default ?? e.value.options?.[0]?.value ?? ''] } : { type: e.type },
    conditions: [],
  }
}

// Names the field an issue belongs to, so the dialog shows it there.
export interface TriggerConfigIssue {
  message: string
  event?: boolean
  condition?: number
  scope?: boolean
}

export function triggerConfigIssues(form: TriggerFormDef, config: TriggerConfig): TriggerConfigIssue[] {
  const def = form.find(k => k.kind === config.kind)
  if (!def) return [{ message: `Unknown trigger kind "${config.kind}"` }]
  const issues: TriggerConfigIssue[] = []

  const { event: on } = config
  const event = def.events.find(e => e.type === on.type)
  const eventIssue = (message: string) => issues.push({ message, event: true })
  if (!event) eventIssue(`Unknown event "${on.type}"`)
  else if (!event.value) {
    if (on.values !== undefined) eventIssue(`"${event.label}" takes no value`)
  }
  else if (!on.values?.length || on.values.some(v => !v.trim())) eventIssue(`"${event.label}" needs a value.`)
  else if (event.value.options && !event.value.optionsUrl) {
    const unknown = on.values.find(v => !event.value!.options!.some(o => o.value === v.trim()))
    if (unknown) eventIssue(`"${unknown.trim()}" is not an option of "${event.label}"`)
  }

  config.conditions.forEach((condition, index) => {
    const filter = def.filters.find(f => f.key === condition.field)
    const issue = (message: string) => issues.push({ message, condition: index })
    if (!filter) issue(`Unknown condition "${condition.field}"`)
    else if (!condition.values.length || condition.values.some(v => !v.trim())) {
      issue(`Fill in or remove the "${filter.label}" condition.`)
    }
    else if (filter.listedOnly && filter.options && !filter.optionsUrl) {
      const unknown = condition.values.find(v => !filter.options!.some(o => o.value === v))
      if (unknown) issue(`"${unknown}" is not an option of "${filter.label}"`)
    }
  })

  const scope = config.scope?.values ?? []
  if (!def.scope) {
    if (config.scope) issues.push({ message: 'This trigger takes no scope', scope: true })
  }
  else if (scope.some(v => !v.trim())) issues.push({ message: `Fill in or remove the "${def.scope.label}".`, scope: true })
  else if (event && def.scope.requiredBy.includes(event.type) && !scope.length) {
    issues.push({ message: `"${event.label}" needs a ${def.scope.label.toLowerCase()}.`, scope: true })
  }
  return issues
}

// A description is rendered with its values set off from the wording around them.
export interface TriggerSegment {
  kind: 'text' | 'value' | 'op' | 'not'
  text: string
}

export interface TriggerDescription {
  kind: string
  event: TriggerSegment[]
  conditions: TriggerSegment[][]
  scope?: TriggerSegment[]
}

const text = (t: string): TriggerSegment => ({ kind: 'text', text: t })
const value = (t: string): TriggerSegment => ({ kind: 'value', text: t })

// `{value}` in the summary takes the plain values; options with their own summary are worded after it.
function describeValues(summary: string, values: string[], input: TriggerValueInput | undefined): TriggerSegment[] {
  const worded: string[] = []
  const plain: string[] = []
  for (const v of values) {
    const option = input?.options?.find(o => o.value === v)
    if (option?.summary) worded.push(option.summary)
    else plain.push(option?.label ?? v)
  }
  const segments: TriggerSegment[] = []
  if (plain.length || !worded.length) {
    const [before = '', after = ''] = summary.split('{value}')
    segments.push(text(before))
    if (plain.length) segments.push(value(plain.join(', ')), text(after))
  }
  if (worded.length) segments.push(text(`${segments.length ? ', ' : ''}${worded.join(', ')}`))
  return segments.filter(s => s.text)
}

export function triggerSummary(form: TriggerFormDef, config: TriggerConfig): TriggerDescription {
  const def = form.find(k => k.kind === config.kind)
  if (!def) return { kind: '', event: [], conditions: [] }
  const event = def.events.find(e => e.type === config.event.type)
  const scopeValues = config.scope?.values ?? []
  const targetsScope = !!event && !!def.scope?.requiredBy.includes(event.type)
  const eventSegments = !event
    ? [text(config.event.type)]
    : describeValues(event.summary, targetsScope ? scopeValues : config.event.values ?? [], targetsScope ? def.scope : event.value)
  const conditions = config.conditions.map((condition): TriggerSegment[] => {
    const filter = def.filters.find(f => f.key === condition.field)
    const labels = condition.values.map(v => filter?.options?.find(o => o.value === v)?.label ?? v)
    const field = (filter?.label ?? condition.field).toLowerCase()
    const op: TriggerSegment = condition.op === 'is' ? { kind: 'op', text: 'is' } : { kind: 'not', text: 'is not' }
    return [text(`${field} `), op, text(' '), value(labels.join(', '))]
  })
  const scope = def.scope && !targetsScope && scopeValues.length
    ? describeValues(`${def.scope.label.toLowerCase()} {value}`, scopeValues, def.scope)
    : undefined
  return { kind: form.length > 1 ? def.label : '', event: eventSegments, conditions, ...(scope ? { scope } : {}) }
}

export const segmentsText = (segments: TriggerSegment[]): string => segments.map(s => s.text).join('')

export function triggerEventLabel({ kind, event, scope }: TriggerDescription): string {
  return `On ${[kind.toLowerCase(), segmentsText(event), scope && `in ${segmentsText(scope)}`].filter(Boolean).join(' · ')}`
}
