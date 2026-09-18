<script setup lang="ts">
import { defaultTriggerConfig, triggerConfigIssues, type TriggerConfig, type TriggerEventDef, type TriggerFormDef } from '#shared/utils/trigger-form'

const props = withDefaults(defineProps<{ form: TriggerFormDef, linkKeys?: string[], showIssues?: boolean }>(), { linkKeys: () => [] })
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
const checked = ref<Record<string, boolean>>({})
const values = ref<Record<string, string>>({})
const rows = ref<{ key: string, text: string }[]>([])

const def = computed(() => props.form.find(k => k.kind === kind.value) ?? props.form[0]!)
const filterDef = (key: string) => def.value.filters.find(f => f.key === key)

function load(c: TriggerConfig) {
  kind.value = c.kind
  checked.value = Object.fromEntries(c.on.map(on => [on.type, true]))
  values.value = Object.fromEntries(def.value.events
    .filter(e => e.value)
    .map(e => [e.type, c.on.find(on => on.type === e.type)?.value ?? e.value!.default ?? e.value!.options?.[0]?.value ?? '']))
  rows.value = Object.entries(c.filters).map(([key, value]) => ({ key, text: value.join(', ') }))
}

load(Array.isArray(config.value.on) ? config.value as unknown as TriggerConfig : defaultTriggerConfig(props.form))

// null: the list could not be loaded, so nothing is known about that project.
const remoteOptions = ref<Record<string, Record<string, string[] | null>>>({})
const remoteEvents = computed(() => def.value.events.filter(e => e.value?.optionsUrl && checked.value[e.type]))

watch([() => props.linkKeys, () => remoteEvents.value.map(e => e.type).join()], async ([keys]) => {
  for (const event of remoteEvents.value) {
    const entries = await Promise.all(keys.map(async key =>
      [key, await $fetch<string[]>(event.value!.optionsUrl!, { query: { project: key } }).catch(() => null)] as const,
    ))
    if (keys !== props.linkKeys) return
    remoteOptions.value[event.type] = Object.fromEntries(entries)
  }
}, { immediate: true })

function projectsWith(event: TriggerEventDef, name: string): string[] {
  return props.linkKeys.filter(key => remoteOptions.value[event.type]?.[key]?.includes(name))
}

const heading = 'k-mono text-3xs font-normal uppercase tracking-(--tracking-label) text-dimmed'

function selectItems(event: TriggerEventDef): SelectItem[] {
  const fixed = event.value?.options ?? []
  if (!event.value?.optionsUrl) return fixed
  const remote = remoteItems(event)
  if (!fixed.length) return remote
  return [
    { type: 'label', label: event.value.optionsHeading, class: heading },
    ...fixed,
    ...(remote.length ? [{ type: 'separator' as const }, ...remote] : []),
  ]
}

function remoteItems(event: TriggerEventDef): SelectItem[] {
  const title = event.value?.remoteHeading
  const names = [...new Set(Object.values(remoteOptions.value[event.type] ?? {}).flatMap(list => list ?? []))]
  const partial = names.filter(n => projectsWith(event, n).length < props.linkKeys.length)
  if (props.linkKeys.length < 2 || !partial.length) {
    return [...(title && names.length ? [{ type: 'label' as const, label: title, class: heading }] : []), ...names.map(n => ({ label: n, value: n }))]
  }
  return [
    { type: 'label', label: `${title ? `${title} · in` : 'In'} all ${props.linkKeys.length} projects`, class: heading },
    ...names.filter(n => !partial.includes(n)).map(n => ({ label: n, value: n })),
    { type: 'separator' },
    { type: 'label', label: 'Only in some', class: heading },
    ...partial.map(n => ({ label: n, value: n, projects: projectsWith(event, n).join(', '), class: 'text-muted' })),
  ]
}

const missing = computed(() => remoteEvents.value.flatMap((event) => {
  const value = values.value[event.type]
  const known = remoteOptions.value[event.type] ?? {}
  const projects = value && !event.value?.options?.some(o => o.value === value) ? props.linkKeys.filter(key => known[key] && !known[key]!.includes(value)) : []
  return projects.length ? [{ value, projects: projects.join(', ') }] : []
}))

const unusedFilters = computed(() => def.value.filters.filter(f => !rows.value.some(r => r.key === f.key)))
const newRow = (key: string) => ({ key, text: filterDef(key)?.options?.[0]?.value ?? '' })
const filterItems = (own: string) => def.value.filters
  .filter(f => f.key === own || unusedFilters.value.includes(f))
  .map(f => ({ label: f.label, value: f.key }))

const built = computed<TriggerConfig>(() => ({
  kind: kind.value,
  on: def.value.events
    .filter(e => checked.value[e.type])
    .map(e => (e.value ? { type: e.type, value: (values.value[e.type] ?? '').trim() } : { type: e.type })),
  filters: Object.fromEntries(rows.value.map(r =>
    [r.key, filterDef(r.key)?.input === 'select' ? [r.text] : r.text.split(',').map(v => v.trim()).filter(Boolean)])),
}))
const issues = computed(() => triggerConfigIssues(props.form, built.value))
const shown = computed(() => (props.showIssues ? issues.value : []))
const eventIssue = (type: string) => shown.value.find(i => i.event === type)?.message
const filterIssue = (key: string) => shown.value.find(i => i.filter === key)?.message
const generalIssue = computed(() => shown.value.find(i => !i.event && !i.filter)?.message)

watch(built, () => {
  config.value = { ...built.value }
  valid.value = !issues.value.length
}, { immediate: true })
</script>

<template>
  <div class="space-y-4">
    <div>
      <div class="flex items-end justify-between">
        <span class="k-label">Fires when</span>
        <div
          v-if="form.length > 1"
          class="flex gap-1.5"
        >
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
      </div>
      <div class="mt-1 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <div
          v-for="event in def.events"
          :key="event.type"
        >
          <div class="flex min-h-8 items-center gap-2">
            <UCheckbox
              v-model="checked[event.type]"
              :label="event.label"
              :ui="{ label: 'whitespace-nowrap' }"
            />
            <UTooltip
              v-if="event.hint"
              :text="event.hint"
            >
              <button
                type="button"
                class="flex shrink-0 cursor-help text-dimmed hover:text-muted"
                :aria-label="event.hint"
              >
                <UIcon
                  name="i-lucide-info"
                  class="size-3.5"
                />
              </button>
            </UTooltip>
            <template v-if="event.value && checked[event.type]">
              <UInput
                v-if="event.value.input === 'text'"
                v-model="values[event.type]"
                :placeholder="event.value.placeholder"
                size="sm"
                class="min-w-0 flex-1"
                :ui="{ base: 'k-mono' }"
              />
              <USelectMenu
                v-else
                v-model="values[event.type]"
                value-key="value"
                :items="selectItems(event)"
                :disabled="!selectItems(event).length"
                :placeholder="selectItems(event).length ? event.value.placeholder : 'Pick a project first'"
                size="sm"
                class="min-w-0 flex-1"
              >
                <template #item-trailing="{ item }">
                  <span
                    v-if="item.projects"
                    class="k-mono text-2xs text-dimmed"
                  >{{ item.projects }}</span>
                </template>
              </USelectMenu>
            </template>
          </div>
          <p
            v-if="eventIssue(event.type)"
            class="mb-1 text-2xs text-error"
          >
            {{ eventIssue(event.type) }}
          </p>
        </div>
      </div>
      <p
        v-if="generalIssue"
        class="mt-1 text-2xs text-error"
      >
        {{ generalIssue }}
      </p>
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
    </div>

    <div v-if="def.filters.length">
      <div class="flex items-center justify-between">
        <span class="k-label">Only when</span>
        <span
          v-if="rows.length > 1"
          class="text-2xs text-dimmed"
        >All filters have to match</span>
      </div>
      <div
        v-for="(row, i) in rows"
        :key="row.key"
        class="mt-2"
      >
        <div class="flex items-center gap-2">
          <USelectMenu
            :model-value="row.key"
            value-key="value"
            :items="filterItems(row.key)"
            :search-input="false"
            size="sm"
            class="w-44 shrink-0"
            @update:model-value="key => rows[i] = newRow(key)"
          />
          <USelectMenu
            v-if="filterDef(row.key)?.input === 'select'"
            v-model="row.text"
            value-key="value"
            :items="filterDef(row.key)?.options"
            :search-input="false"
            size="sm"
            class="flex-1"
          />
          <UInput
            v-else
            v-model="row.text"
            :placeholder="filterDef(row.key)?.placeholder"
            size="sm"
            class="flex-1"
            :ui="{ base: 'k-mono' }"
          />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Remove filter"
            @click="rows.splice(i, 1)"
          />
        </div>
        <p
          v-if="filterIssue(row.key)"
          class="mt-1 text-2xs text-error"
        >
          {{ filterIssue(row.key) }}
        </p>
      </div>
      <UDropdownMenu
        v-if="unusedFilters.length"
        :items="unusedFilters.map(f => ({ label: f.label, onSelect: () => rows.push(newRow(f.key)) }))"
      >
        <UButton
          icon="i-lucide-plus"
          label="Add filter"
          color="neutral"
          variant="outline"
          size="xs"
          class="mt-2 border-dashed"
        />
      </UDropdownMenu>
    </div>
  </div>
</template>
