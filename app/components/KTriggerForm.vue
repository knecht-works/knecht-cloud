<script setup lang="ts">
import { defaultTriggerConfig, triggerConfigIssues, type TriggerCondition, type TriggerConfig, type TriggerFormDef, type TriggerValueInput } from '#shared/utils/trigger-form'

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
const values = ref<Record<string, string[]>>({})
const groups = ref<TriggerCondition[][]>([])

const def = computed(() => props.form.find(k => k.kind === kind.value) ?? props.form[0]!)
const filterDef = (key: string) => def.value.filters.find(f => f.key === key)

function load(c: TriggerConfig) {
  kind.value = c.kind
  checked.value = Object.fromEntries(c.on.map(on => [on.type, true]))
  values.value = Object.fromEntries(def.value.events
    .filter(e => e.value)
    .map(e => [e.type, c.on.find(on => on.type === e.type)?.values ?? [e.value!.default ?? e.value!.options?.[0]?.value ?? ''].filter(Boolean)]))
  groups.value = c.conditions.map(group => group.map(condition => ({ ...condition, values: [...condition.values] })))
}

load(Array.isArray(config.value.on) ? config.value as unknown as TriggerConfig : defaultTriggerConfig(props.form))

// null: the list could not be loaded, so nothing is known about that project.
const remoteOptions = ref<Record<string, Record<string, string[] | null>>>({})
const remoteEvents = computed(() => def.value.events.filter(e => e.value?.optionsUrl && checked.value[e.type]))
const filterSource = (key: string) => `filter:${key}`
const remoteSources = computed(() => [
  ...remoteEvents.value.map(e => ({ id: e.type, url: e.value!.optionsUrl! })),
  ...[...new Set(groups.value.flat().map(c => c.field))].flatMap((key) => {
    const url = filterDef(key)?.optionsUrl
    return url ? [{ id: filterSource(key), url }] : []
  }),
])

watch([() => props.linkKeys, () => remoteSources.value.map(s => s.id).join()], async ([keys]) => {
  for (const source of remoteSources.value) {
    const entries = await Promise.all(keys.map(async key =>
      [key, await $fetch<string[]>(source.url, { query: { project: key } }).catch(() => null)] as const,
    ))
    if (keys !== props.linkKeys) return
    remoteOptions.value[source.id] = Object.fromEntries(entries)
  }
}, { immediate: true })

function projectsWith(source: string, name: string): string[] {
  return props.linkKeys.filter(key => remoteOptions.value[source]?.[key]?.includes(name))
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
  const partial = names.filter(n => projectsWith(source, n).length < props.linkKeys.length)
  if (props.linkKeys.length < 2 || !partial.length) {
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

const missing = computed(() => remoteEvents.value.flatMap((event) => {
  const known = remoteOptions.value[event.type] ?? {}
  return (values.value[event.type] ?? []).flatMap((value) => {
    const projects = event.value?.options?.some(o => o.value === value) ? [] : props.linkKeys.filter(key => known[key] && !known[key]!.includes(value))
    return projects.length ? [{ value, projects: projects.join(', ') }] : []
  })
}))

const OP_ITEMS = [{ label: 'is', value: 'is' }, { label: 'is not', value: 'is-not' }]
const fieldItems = computed(() => def.value.filters.map(f => ({ label: f.label, value: f.key })))

const newCondition = (field: string): TriggerCondition => ({ field, op: 'is', values: [] })

function removeCondition(gi: number, ci: number) {
  groups.value[gi]!.splice(ci, 1)
  if (!groups.value[gi]!.length) groups.value.splice(gi, 1)
}

const built = computed<TriggerConfig>(() => ({
  kind: kind.value,
  on: def.value.events
    .filter(e => checked.value[e.type])
    .map(e => (e.value ? { type: e.type, values: (values.value[e.type] ?? []).map(v => v.trim()).filter(Boolean) } : { type: e.type })),
  conditions: groups.value.map(group => group.map(c => ({ ...c, values: c.values.map(v => v.trim()).filter(Boolean) }))),
}))
const issues = computed(() => triggerConfigIssues(props.form, built.value))
const shown = computed(() => (props.showIssues ? issues.value : []))
const eventIssue = (type: string) => shown.value.find(i => i.event === type)?.message
const conditionIssue = (gi: number, ci: number) => shown.value.find(i => i.condition?.[0] === gi && i.condition[1] === ci)?.message
const generalIssue = computed(() => shown.value.find(i => !i.event && !i.condition)?.message)

watch(built, () => {
  config.value = { ...built.value }
  valid.value = !issues.value.length
}, { immediate: true })
</script>

<template>
  <div class="space-y-4">
    <div>
      <div class="flex items-center justify-between">
        <span class="k-label">Fires when any of these happens</span>
        <div
          v-if="form.length > 1"
          class="flex gap-2"
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
      <div class="mt-1 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
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
            <USelectMenu
              v-if="event.value && checked[event.type]"
              v-model="values[event.type]"
              value-key="value"
              :items="menuItems(event.value, event.type, values[event.type] ?? [])"
              multiple
              :create-item="!event.value.listedOnly"
              :placeholder="event.value.placeholder"
              size="sm"
              class="min-w-0 flex-1"
              @create="typed => values[event.type] = [...(values[event.type] ?? []), typed.trim()]"
            >
              <template #item-trailing="{ item }">
                <span
                  v-if="item.projects"
                  class="k-mono text-2xs text-dimmed"
                >{{ item.projects }}</span>
              </template>
            </USelectMenu>
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
      <span class="k-label">But only if</span>
      <template
        v-for="(group, gi) in groups"
        :key="gi"
      >
        <div
          v-if="gi > 0"
          class="k-mono mt-2 text-3xs uppercase tracking-widest text-dimmed"
        >
          or
        </div>
        <div class="mt-2 flex flex-col gap-1.5 rounded-md border border-muted p-2">
          <div
            v-for="(condition, ci) in group"
            :key="ci"
          >
            <div class="flex items-center gap-2">
              <USelectMenu
                :model-value="condition.field"
                value-key="value"
                :items="fieldItems"
                :search-input="false"
                size="sm"
                class="w-36 shrink-0"
                @update:model-value="field => group[ci] = newCondition(field)"
              />
              <USelectMenu
                v-model="condition.op"
                value-key="value"
                :items="OP_ITEMS"
                :search-input="false"
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
                @click="removeCondition(gi, ci)"
              />
            </div>
            <p
              v-if="conditionIssue(gi, ci)"
              class="mt-1 text-2xs text-error"
            >
              {{ conditionIssue(gi, ci) }}
            </p>
          </div>
          <div>
            <UDropdownMenu :items="def.filters.map(f => ({ label: f.label, onSelect: () => group.push(newCondition(f.key)) }))">
              <UButton
                icon="i-lucide-plus"
                label="and"
                color="neutral"
                variant="ghost"
                size="xs"
              />
            </UDropdownMenu>
          </div>
        </div>
      </template>
      <div>
        <UDropdownMenu :items="def.filters.map(f => ({ label: f.label, onSelect: () => groups.push([newCondition(f.key)]) }))">
          <UButton
            icon="i-lucide-plus"
            :label="groups.length ? 'or group' : 'Add condition'"
            color="neutral"
            variant="outline"
            size="xs"
            class="mt-2 border-dashed"
          />
        </UDropdownMenu>
      </div>
    </div>
  </div>
</template>
