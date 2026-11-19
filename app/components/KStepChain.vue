<script setup lang="ts">
import type { WorkflowStep } from '~/utils/dashboard'
import { ref, computed } from 'vue'
import { useElementWidth } from '~/composables/useElementWidth'
import { workflowStepMeta } from '~/utils/workflow-steps'
import { STEP_KIND_COLOR } from '~/utils/dashboard'
import { UIcon } from '#components'

const props = defineProps<{
  steps: WorkflowStep[]
  large?: boolean
}>()

const root = ref<HTMLElement>()
const width = useElementWidth(root)

const box = computed(() => props.large ? 32 : 24)
const link = computed(() => props.large ? 12 : 8)

const visible = computed(() => {
  const metas = props.steps.map(workflowStepMeta)
  if (width.value == null) return { metas, hidden: 0 }
  const fits = Math.floor((width.value + link.value) / (box.value + link.value))
  if (metas.length <= fits) return { metas, hidden: 0 }
  const keep = Math.max(fits - 1, 0)
  return { metas: metas.slice(0, keep), hidden: metas.length - keep }
})
</script>

<template>
  <div
    ref="root"
    class="flex min-w-0 items-center overflow-hidden"
  >
    <template
      v-for="(s, i) in visible.metas"
      :key="i"
    >
      <span
        v-if="i"
        class="h-px flex-none bg-(--border-accented)"
        :style="{ width: `${link}px` }"
      />
      <span
        class="grid flex-none place-items-center border border-default bg-(--surface-accented)"
        :class="large ? 'size-8 rounded-lg' : 'size-6 rounded-md'"
        :style="{ color: STEP_KIND_COLOR[s.kind] }"
      >
        <UIcon
          :name="s.icon"
          :class="large ? 'size-4' : 'size-3.25'"
        />
      </span>
    </template>
    <template v-if="visible.hidden">
      <span
        v-if="visible.metas.length"
        class="h-px flex-none bg-(--border-accented)"
        :style="{ width: `${link}px` }"
      />
      <span
        class="grid flex-none place-items-center border border-default text-muted tabular-nums"
        :class="large ? 'size-8 rounded-lg text-xs' : 'size-6 rounded-md text-2xs'"
      >+{{ visible.hidden }}</span>
    </template>
  </div>
</template>
