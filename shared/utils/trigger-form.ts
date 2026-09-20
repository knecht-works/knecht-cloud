// An integration describes its trigger as data. The config schema, the event
// label and the trigger dialog all derive from it; only the matcher is code.

export interface TriggerValueInput {
  input: 'text' | 'select'
  placeholder?: string
  default?: string
  options?: { label: string, value: string, summary?: string }[]
  optionsHeading?: string
  optionsUrl?: string
  remoteHeading?: string
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
  summary: string
  input: 'list' | 'select'
  placeholder?: string
  // The choices of a select. On a list they and `optionsUrl` are suggestions: patterns like `kn*` can still be typed.
  options?: { label: string, value: string, summary?: string }[]
  optionsUrl?: string
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
  value?: string
}

// Events are alternatives (any of them fires), filters all have to hold.
export interface TriggerConfig {
  kind: string
  on: TriggerEventConfig[]
  filters: Record<string, string[]>
}

export function defaultTriggerConfig(form: TriggerFormDef, kind = form[0]!.kind): TriggerConfig {
  const def = form.find(k => k.kind === kind) ?? form[0]!
  return {
    kind: def.kind,
    on: def.events
      .filter(e => e.default)
      .map(e => (e.value ? { type: e.type, value: e.value.default ?? e.value.options?.[0]?.value ?? '' } : { type: e.type })),
    filters: {},
  }
}

// Names the event or filter an issue belongs to, so the dialog shows it under that field.
export interface TriggerConfigIssue {
  message: string
  event?: string
  filter?: string
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
      if (on.value !== undefined) issue(`"${event.label}" takes no value`)
    }
    else if (!on.value?.trim()) issue(`"${event.label}" needs a value.`)
    else if (event.value.options && !event.value.optionsUrl && !event.value.options.some(o => o.value === on.value!.trim())) {
      issue(`"${on.value.trim()}" is not an option of "${event.label}"`)
    }
    seen.add(on.type)
  }

  for (const [key, value] of Object.entries(config.filters)) {
    const filter = def.filters.find(f => f.key === key)
    const issue = (message: string) => issues.push({ message, filter: key })
    if (!filter) issue(`Unknown filter "${key}"`)
    else if (filter.input === 'select') {
      if (value.length !== 1 || !filter.options?.some(o => o.value === value[0])) issue(`Pick an option for "${filter.label}".`)
    }
    else if (!value.length || value.some(v => !v.trim())) {
      issue(`Fill in or remove the "${filter.label}" filter.`)
    }
  }
  return issues
}

export function triggerSummary(form: TriggerFormDef, config: TriggerConfig): string {
  const def = form.find(k => k.kind === config.kind)
  if (!def) return ''
  const events = config.on.map((on) => {
    const event = def.events.find(e => e.type === on.type)
    if (!event) return on.type
    const option = event.value?.options?.find(o => o.value === on.value)
    return option?.summary ?? event.summary.replace('{value}', option?.label ?? on.value ?? '')
  })
  const filters = Object.entries(config.filters).map(([key, value]) => {
    const filter = def.filters.find(f => f.key === key)
    const option = filter?.options?.find(o => o.value === value[0])
    return option?.summary ?? (filter?.summary ?? key).replace('{value}', option?.label ?? value.join(', '))
  })
  const head = form.length > 1 ? [def.label.toLowerCase()] : []
  return `On ${[...head, events.join(', '), ...filters].filter(Boolean).join(' · ')}`
}
