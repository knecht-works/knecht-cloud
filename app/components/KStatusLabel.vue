<script setup lang="ts">
// Status row: a dot (or a checked ring for "done") followed by an uppercase
// mono status label. Used in the run log.
const props = withDefaults(defineProps<{
  status?: 'done' | 'progress' | 'rest'
  label?: string
}>(), {
  status: 'rest',
})

const META = {
  done: { color: 'primary' as const, label: 'Done', text: 'var(--text-primary)', pulse: false, check: true },
  progress: { color: 'orange' as const, label: 'Running', text: 'var(--accent-orange)', pulse: true, check: false },
  rest: { color: 'neutral' as const, label: 'Planned', text: 'var(--text-dimmed)', pulse: false, check: false },
}

const s = computed(() => META[props.status])
</script>

<template>
  <span class="inline-flex h-[22px] items-center gap-2.5">
    <span
      v-if="s.check"
      class="grid size-[22px] flex-none place-items-center rounded-full text-(--text-primary)"
      style="border: 1px solid color-mix(in oklab, var(--primary) 55%, transparent)"
    >
      <UIcon
        name="i-lucide-check"
        class="size-3"
      />
    </span>
    <KStatusDot
      v-else
      :color="s.color"
      :pulse="s.pulse"
    />
    <span
      class="k-mono text-[11px] font-medium uppercase tracking-[0.1em]"
      :style="{ color: s.text }"
    >{{ label ?? s.label }}</span>
  </span>
</template>
