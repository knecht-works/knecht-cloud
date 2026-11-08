<script setup lang="ts">
import { defaultTriggerConfig, triggerConfigIssues, type TriggerCondition, type TriggerConfig, type TriggerFormDef, type TriggerValueInput } from '#shared/utils/trigger-form'

const props = withDefaults(defineProps<{ form: TriggerFormDef, optionTargets?: { key: string, name: string }[], showIssues?: boolean }>(), { optionTargets: () => [] })
const config = defineModel<Record<string, unknown>>('config', { required: true })
const valid = defineModel<boolean>('valid', { default: false })

interface SelectItem {
  type?: 'label' | 'separator'
  label?: string
  value?: string
  projects?: string
  class?: string
}

const kind = ref('')
const eventType = ref('')
// Per event, so switching between events keeps what was picked for each.
const values = ref<Record<string, string[]>>({})
const conditions = ref<TriggerCondition[]>([])
const scope = ref<string[]>([])

const def = computed(() => props.form.find(k => k.kind === kind.value) ?? props.form[0]!)
const filterDef = (key: string) => def.value.filters.find(f => f.key === key)

function load(c: TriggerConfig) {
  kind.value = c.kind
  eventType.value = c.event.type
  values.value = Object.fromEntries(def.value.events
    .filter(e => e.value)
    .map(e => [e.type, (c.event.type === e.type ? c.event.values : undefined) ?? [e.value!.default ?? e.value!.options?.[0]?.value ?? ''].filter(Boolean)]))
  conditions.value = c.conditions.map(condition => ({ ...condition, values: [...condition.values] }))
  scope.value = [...c.scope?.values ?? []]
}

load(config.value.event ? config.value as unknown as TriggerConfig : defaultTriggerConfig(props.form))

const event = computed(() => def.value.events.find(e => e.type === eventType.value))
const eventItems = computed(() => def.value.events.map(e => ({ label: e.label, value: e.type, hint: e.hint })))
const scopeRequired = computed(() => !!def.value.scope?.requiredBy.includes(eventType.value))

// null: the list could not be loaded, so nothing is known about that project.
const remoteOptions = ref<Record<string, Record<string, string[] | null>>>({})
const remoteEvents = computed(() => (event.value?.value?.optionsUrl ? [event.value] : []))
const filterSource = (key: string) => `filter:${key}`
const SCOPE_SOURCE = 'scope'
const remoteSources = computed(() => [
  ...remoteEvents.value.map(e => ({ id: e.type, url: e.value!.optionsUrl! })),
  ...(def.value.scope?.optionsUrl ? [{ id: SCOPE_SOURCE, url: def.value.scope.optionsUrl }] : []),
  ...[...new Set(conditions.value.map(c => c.field))].flatMap((key) => {
    const url = filterDef(key)?.optionsUrl
    return url ? [{ id: filterSource(key), url }] : []
  }),
])

watch([() => props.optionTargets, () => remoteSources.value.map(s => s.id).join()], async ([targets]) => {
  for (const source of remoteSources.value) {
    const entries = await Promise.all(targets.map(async ({ key }) =>
      [key, await $fetch<string[]>(source.url, { query: { project: key } }).catch(() => null)] as const,
    ))
    if (targets !== props.optionTargets) return
    remoteOptions.value[source.id] = Object.fromEntries(entries)
  }
}, { immediate: true })

function projectsWith(source: string, name: string): string[] {
  return props.optionTargets.filter(t => remoteOptions.value[source]?.[t.key]?.includes(name)).map(t => t.name)
}

const heading = 'k-mono text-3xs font-normal uppercase tracking-(--tracking-label) text-dimmed'

type OptionSource = Pick<TriggerValueInput, 'options' | 'optionsHeading' | 'optionsUrl' | 'remoteHeading'>

// A typed value, or one the tool no longer lists, has to be an item for the menu to show it.
function menuItems(input: OptionSource | undefined, source: string, picked: string[]): SelectItem[] {
  const items = listedItems(input, source)
  return [...items, ...picked.filter(v => v && !items.some(i => i.value === v)).map(v => ({ label: v, value: v }))]
}

function listedItems(input: OptionSource | undefined, source: string): SelectItem[] {
  const fixed = input?.options ?? []
  if (!input?.optionsUrl) return fixed
  const remote = remoteItems(input.remoteHeading, source)
  if (!fixed.length) return remote
  return [
    { type: 'label', label: input.optionsHeading, class: heading },
    ...fixed,
    ...(remote.length ? [{ type: 'separator' as const }, ...remote] : []),
  ]
}

function remoteItems(title: string | undefined, source: string): SelectItem[] {
  const names = [...new Set(Object.values(remoteOptions.value[source] ?? {}).flatMap(list => list ?? []))]
  const partial = names.filter(n => projectsWith(source, n).length < props.optionTargets.length)
  if (props.optionTargets.length < 2 || !partial.length) {
    return [...(title && names.length ? [{ type: 'label' as const, label: title, class: heading }] : []), ...names.map(n => ({ label: n, value: n }))]
  }
  return [
    { type: 'label', label: title ?? 'In all projects', class: heading },
    ...names.filter(n => !partial.includes(n)).map(n => ({ label: n, value: n })),
    { type: 'separator' },
    { type: 'label', label: 'Only in some', class: heading },
    ...partial.map(n => ({ label: n, value: n, projects: projectsWith(source, n).join(', '), class: 'text-muted' })),
  ]
}

const missing = computed(() => remoteEvents.value.flatMap((e) => {
  const known = remoteOptions.value[e.type] ?? {}
  return (values.value[e.type] ?? []).flatMap((value) => {
    const projects = e.value?.options?.some(o => o.value === value) ? [] : props.optionTargets.filter(t => known[t.key] && !known[t.key]!.includes(value)).map(t => t.name)
    return projects.length ? [{ value, projects: projects.join(', ') }] : []
  })
}))

const OP_ITEMS = [{ label: 'is', value: 'is' }, { label: 'is not', value: 'is-not' }]
const fieldItems = computed(() => def.value.filters.map(f => ({ label: f.label, value: f.key })))

const newCondition = (field: string): TriggerCondition => ({ field, op: 'is', values: [] })

const trimmed = (list: string[]) => list.map(v => v.trim()).filter(Boolean)
const built = computed<TriggerConfig>(() => ({
  kind: kind.value,
  event: event.value?.value ? { type: eventType.value, values: trimmed(values.value[eventType.value] ?? []) } : { type: eventType.value },
  conditions: conditions.value.map(c => ({ ...c, values: trimmed(c.values) })),
  ...(def.value.scope && scope.value.length ? { scope: { values: trimmed(scope.value) } } : {}),
}))
const issues = computed(() => triggerConfigIssues(props.form, built.value))
const shown = computed(() => (props.showIssues ? issues.value : []))
const eventIssue = computed(() => shown.value.find(i => i.event)?.message)
const scopeIssue = computed(() => shown.value.find(i => i.scope)?.message)
const conditionIssue = (index: number) => shown.value.find(i => i.condition === index)?.message
const generalIssue = computed(() => shown.value.find(i => !i.event && !i.scope && i.condition === undefined)?.message)

watch(built, () => {
  config.value = { ...built.value }
  valid.value = !issues.value.length
}, { immediate: true })
</script>

<template>
  <div class="space-y-4">
    <UFormField
      label="Fires when"
      :error="generalIssue"
    >
      <template
        v-if="form.length > 1"
        #hint
      >
        <div class="flex gap-2">
          <button
            v-for="k in form"
            :key="k.kind"
            type="button"
            class="k-mono cursor-pointer rounded-full border px-3 py-1 text-2xs transition-colors"
            :class="k.kind === kind
              ? 'border-(--primary-border) bg-(--lime-950) text-primary'
              : 'border-default text-dimmed hover:text-muted'"
            @click="k.kind !== kind && load(defaultTriggerConfig(form, k.kind))"
          >
            {{ k.label }}
          </button>
        </div>
      </template>
      <div class="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <div
          v-for="item in eventItems"
          :key="item.value"
        >
          <div class="flex min-h-8 items-center gap-2">
            <URadioGroup
              v-model="eventType"
              :items="[item]"
              :ui="{ label: 'whitespace-nowrap' }"
            >
              <template #label>
                <span class="inline-flex items-center gap-1.5">
                  {{ item.label }}
                  <UTooltip
                    v-if="item.hint"
                    :text="item.hint"
                  >
                    <UIcon
                      name="i-lucide-info"
                      class="size-3.5 cursor-help text-dimmed hover:text-muted"
                    />
                  </UTooltip>
                </span>
              </template>
            </URadioGroup>
            <USelectMenu
              v-if="item.value === eventType && event?.value"
              v-model="values[event.type]"
              value-key="value"
              :items="menuItems(event.value, event.type, values[event.type] ?? [])"
              multiple
              :create-item="!event.value.listedOnly"
              :placeholder="event.value.placeholder"
              :aria-label="item.label"
              size="sm"
              class="min-w-0 flex-1"
              @create="typed => values[event!.type] = [...(values[event!.type] ?? []), typed.trim()]"
            >
              <template #item-trailing="{ item: option }">
                <span
                  v-if="option.projects"
                  class="k-mono text-2xs text-dimmed"
                >{{ option.projects }}</span>
              </template>
            </USelectMenu>
            <USelectMenu
              v-if="item.value === eventType && scopeRequired && def.scope"
              v-model="scope"
              value-key="value"
              :items="menuItems(def.scope, SCOPE_SOURCE, scope)"
              multiple
              :placeholder="def.scope.placeholder"
              :aria-label="def.scope.label"
              size="sm"
              class="min-w-0 flex-1"
            >
              <template #item-trailing="{ item: option }">
                <span
                  v-if="option.projects"
                  class="k-mono text-2xs text-dimmed"
                >{{ option.projects }}</span>
              </template>
            </USelectMenu>
          </div>
          <p
            v-if="item.value === eventType && (eventIssue || (scopeRequired && scopeIssue))"
            class="mb-1 text-2xs text-error"
          >
            {{ eventIssue ?? scopeIssue }}
          </p>
        </div>
      </div>
      <p
        v-for="miss in missing"
        :key="miss.value"
        class="mt-2 flex gap-2.5 rounded-md border border-(--status-orange)/35 bg-(--status-orange)/8 px-3 py-2.5 text-2xs leading-normal text-muted"
      >
        <UIcon
          name="i-lucide-triangle-alert"
          class="mt-px size-4 shrink-0 text-(--status-orange)"
        />
        <span>
          <span class="font-medium text-default">"{{ miss.value }}" does not exist in {{ miss.projects }}.</span>
          Nothing there will ever fire this trigger. Pick a value all projects share or create a separate trigger for them.
        </span>
      </p>
    </UFormField>

    <UFormField
      v-if="def.scope && !scopeRequired"
      :label="`While the ${def.scope.label.toLowerCase()} is`"
      :error="scopeIssue"
    >
      <USelectMenu
        v-model="scope"
        value-key="value"
        :items="menuItems(def.scope, SCOPE_SOURCE, scope)"
        multiple
        :placeholder="`Any ${def.scope.label.toLowerCase()}`"
        size="sm"
        class="w-full"
      >
        <template #item-trailing="{ item }">
          <span
            v-if="item.projects"
            class="k-mono text-2xs text-dimmed"
          >{{ item.projects }}</span>
        </template>
      </USelectMenu>
    </UFormField>

    <UFormField
      v-if="def.filters.length"
      label="But only if"
    >
      <div
        v-if="conditions.length"
        class="flex flex-col gap-1.5 rounded-md border border-muted p-2"
      >
        <div
          v-for="(condition, ci) in conditions"
          :key="ci"
        >
          <div class="flex items-center gap-2">
            <USelectMenu
              :model-value="condition.field"
              value-key="value"
              :items="fieldItems"
              :search-input="false"
              aria-label="Field"
              size="sm"
              class="w-36 shrink-0"
              @update:model-value="field => conditions[ci] = newCondition(field)"
            />
            <USelectMenu
              v-model="condition.op"
              value-key="value"
              :items="OP_ITEMS"
              :search-input="false"
              aria-label="Operator"
              size="sm"
              class="w-24 shrink-0"
            />
            <USelectMenu
              v-model="condition.values"
              value-key="value"
              :items="menuItems(filterDef(condition.field), filterSource(condition.field), condition.values)"
              multiple
              :create-item="!filterDef(condition.field)?.listedOnly"
              :placeholder="filterDef(condition.field)?.placeholder"
              aria-label="Values"
              size="sm"
              class="min-w-0 flex-1"
              @create="pattern => condition.values = [...condition.values, pattern.trim()]"
            >
              <template #item-trailing="{ item }">
                <span
                  v-if="item.projects"
                  class="k-mono text-2xs text-dimmed"
                >{{ item.projects }}</span>
              </template>
            </USelectMenu>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Remove condition"
              @click="conditions.splice(ci, 1)"
            />
          </div>
          <p
            v-if="conditionIssue(ci)"
            class="mt-1 text-2xs text-error"
          >
            {{ conditionIssue(ci) }}
          </p>
        </div>
      </div>
      <div>
        <UDropdownMenu :items="def.filters.map(f => ({ label: f.label, onSelect: () => conditions.push(newCondition(f.key)) }))">
          <UButton
            icon="i-lucide-plus"
            :label="conditions.length ? 'and' : 'Add condition'"
            color="neutral"
            variant="outline"
            size="xs"
            class="mt-2 border-dashed"
          />
        </UDropdownMenu>
      </div>
    </UFormField>
  </div>
</template>
