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

export interface TriggerKindDef {
  kind: string
  label: string
  events: TriggerEventDef[]
  filters: TriggerFilterDef[]
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

// Events are alternatives (any of them fires). Conditions are alternative groups, and within a group all have to hold.
export interface TriggerConfig {
  kind: string
  on: TriggerEventConfig[]
  conditions: TriggerCondition[][]
}

export function defaultTriggerConfig(form: TriggerFormDef, kind = form[0]!.kind): TriggerConfig {
  const def = form.find(k => k.kind === kind) ?? form[0]!
  return {
    kind: def.kind,
    on: def.events
      .filter(e => e.default)
      .map(e => (e.value ? { type: e.type, values: [e.value.default ?? e.value.options?.[0]?.value ?? ''] } : { type: e.type })),
    conditions: [],
  }
}

// Names the event or condition an issue belongs to, so the dialog shows it under that field.
export interface TriggerConfigIssue {
  message: string
  event?: string
  condition?: [group: number, index: number]
}

export function triggerConfigIssues(form: TriggerFormDef, config: TriggerConfig): TriggerConfigIssue[] {
  const def = form.find(k => k.kind === config.kind)
  if (!def) return [{ message: `Unknown trigger kind "${config.kind}"` }]
  const issues: TriggerConfigIssue[] = []
  if (!config.on.length) issues.push({ message: 'Pick at least one event.' })

  const seen = new Set<string>()
  for (const on of config.on) {
    const event = def.events.find(e => e.type === on.type)
    const issue = (message: string) => issues.push({ message, event: on.type })
    if (!event) issue(`Unknown event "${on.type}"`)
    else if (seen.has(on.type)) issue(`"${event.label}" is listed twice`)
    else if (!event.value) {
      if (on.values !== undefined) issue(`"${event.label}" takes no value`)
    }
    else if (!on.values?.length || on.values.some(v => !v.trim())) issue(`"${event.label}" needs a value.`)
    else if (event.value.options && !event.value.optionsUrl) {
      const unknown = on.values.find(v => !event.value!.options!.some(o => o.value === v.trim()))
      if (unknown) issue(`"${unknown.trim()}" is not an option of "${event.label}"`)
    }
    seen.add(on.type)
  }

  config.conditions.forEach((group, gi) => {
    if (!group.length) issues.push({ message: 'Fill in or remove the empty condition group.' })
    group.forEach((condition, ci) => {
      const filter = def.filters.find(f => f.key === condition.field)
      const issue = (message: string) => issues.push({ message, condition: [gi, ci] })
      if (!filter) issue(`Unknown condition "${condition.field}"`)
      else if (!condition.values.length || condition.values.some(v => !v.trim())) {
        issue(`Fill in or remove the "${filter.label}" condition.`)
      }
      else if (filter.listedOnly && filter.options && !filter.optionsUrl) {
        const unknown = condition.values.find(v => !filter.options!.some(o => o.value === v))
        if (unknown) issue(`"${unknown}" is not an option of "${filter.label}"`)
      }
    })
  })
  return issues
}

export function triggerSummary(form: TriggerFormDef, config: TriggerConfig): string {
  const def = form.find(k => k.kind === config.kind)
  if (!def) return ''
  const events = config.on.map((on) => {
    const event = def.events.find(e => e.type === on.type)
    if (!event) return on.type
    const worded: string[] = []
    const plain: string[] = []
    for (const value of on.values ?? []) {
      const option = event.value?.options?.find(o => o.value === value)
      if (option?.summary) worded.push(option.summary)
      else plain.push(option?.label ?? `"${value}"`)
    }
    return [...(plain.length || !worded.length ? [event.summary.replace('{value}', plain.join(', '))] : []), ...worded].join(', ')
  })
  const groups = config.conditions.map(group => group.map((condition) => {
    const filter = def.filters.find(f => f.key === condition.field)
    const labels = condition.values.map(v => filter?.options?.find(o => o.value === v)?.label ?? v)
    return `${(filter?.label ?? condition.field).toLowerCase()} ${condition.op === 'is' ? 'is' : 'is not'} ${labels.join(', ')}`
  }))
  const conditions = groups.length > 1 ? [groups.map(g => g.join(' and ')).join(' or ')] : groups[0] ?? []
  const head = form.length > 1 ? [def.label.toLowerCase()] : []
  return `On ${[...head, events.join(', '), ...conditions].filter(Boolean).join(' · ')}`
}
