<script setup lang="ts">
// The step library: searchable, grouped by kind; Enter adds the top match —
// the fast path is type-two-letters-Enter. Items can also be dragged straight
// into the rail (the page tracks the dragged type + insertion point).
const props = defineProps<{ editable: boolean }>()
const emit = defineEmits<{
  add: [type: WorkflowStep['type']]
  drag: [type: WorkflowStep['type']]
  dragend: []
}>()

const query = ref('')

const groups = computed(() => {
  const q = query.value.trim().toLowerCase()
  const defs = q
    ? STEP_DEFS.filter(d =>
        d.label.toLowerCase().includes(q) || d.type.includes(q) || d.hint.toLowerCase().includes(q))
    : STEP_DEFS
  const byGroup = new Map<string, RegisteredStepDef[]>()
  for (const d of defs) {
    byGroup.set(d.group, [...(byGroup.get(d.group) ?? []), d])
  }
  return [...byGroup.entries()].map(([label, items]) => ({ label, items }))
})

const KIND_DOT: Record<string, 'primary' | 'orange' | 'neutral'> = { det: 'neutral', ai: 'orange', out: 'primary' }

function add(type: WorkflowStep['type']) {
  if (!props.editable) return
  emit('add', type)
  query.value = ''
}

function onDragStart(type: WorkflowStep['type'], e: DragEvent) {
  if (!props.editable) return
  emit('drag', type)
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('text/plain', type)
  }
}

function addTop() {
  const top = groups.value[0]?.items[0]
  if (top) add(top.type)
}
</script>

<template>
  <KPanel
    title="Step library"
    icon="i-lucide-plus"
  >
    <div class="flex flex-col gap-4">
      <UInput
        v-model="query"
        icon="i-lucide-search"
        placeholder="Search steps…"
        :disabled="!editable"
        class="w-full"
        :ui="{ base: 'text-[12.5px]' }"
        @keydown.enter="addTop"
      />

      <p
        v-if="!groups.length"
        class="k-mono px-1 text-[11.5px] text-(--text-dimmed)"
      >
        No step matches "{{ query }}".
      </p>

      <div
        v-for="g in groups"
        :key="g.label"
      >
        <div class="mb-2.5 flex items-center gap-1.5">
          <KStatusDot
            :color="KIND_DOT[g.items[0]!.kind] ?? 'neutral'"
            :size="5"
          />
          <span class="k-mono text-[10.5px] uppercase tracking-[0.08em] text-(--text-dimmed)">{{ g.label }}</span>
        </div>
        <div class="flex flex-col gap-1.5">
          <button
            v-for="d in g.items"
            :key="d.type"
            type="button"
            :disabled="!editable"
            :draggable="editable"
            class="flex cursor-grab items-center gap-2.5 rounded-(--radius-md) border border-(--border-default) bg-(--surface-base) px-3 py-2.5 text-left transition-colors hover:bg-(--surface-glass) active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
            @click="add(d.type)"
            @dragstart="onDragStart(d.type, $event)"
            @dragend="emit('dragend')"
          >
            <KStepIcon
              :icon="d.icon"
              :color="STEP_KIND_COLOR[d.kind]"
              :size="26"
              :radius="6"
            />
            <span class="min-w-0 flex-1">
              <span class="block text-[12.5px] text-(--text-toned)">{{ d.label }}</span>
              <span class="block truncate text-[11px] text-(--text-dimmed)">{{ d.hint }}</span>
            </span>
            <UIcon
              name="i-lucide-plus"
              class="size-[14px] flex-none text-(--text-dimmed)"
            />
          </button>
        </div>
      </div>
    </div>
  </KPanel>
</template>
