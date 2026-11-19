<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useElementWidth } from '~/composables/useElementWidth'
import { UTooltip } from '#components'

const props = defineProps<{
  projects: string[]
}>()

const GAP = 6
const MORE_WIDTH = 36

const root = ref<HTMLElement>()
const measure = ref<HTMLElement>()
const width = useElementWidth(root)
const fit = ref(2)

const shown = computed(() => props.projects.slice(0, fit.value))

function layout() {
  if (width.value == null || !measure.value) return
  let used = 0
  let count = 0
  for (const [i, chip] of [...measure.value.children].entries()) {
    used += (chip as HTMLElement).offsetWidth + (i ? GAP : 0)
    const hasMore = i < props.projects.length - 1
    if (used + (hasMore ? GAP + MORE_WIDTH : 0) > width.value) break
    count++
  }
  fit.value = Math.max(count, 1)
}

watch([width, () => props.projects], layout, { flush: 'post' })
</script>

<template>
  <div
    ref="root"
    class="relative min-w-0 overflow-hidden"
  >
    <div
      ref="measure"
      aria-hidden="true"
      class="invisible absolute flex gap-1.5 whitespace-nowrap"
    >
      <span
        v-for="p in projects"
        :key="p"
        class="k-code text-2xs"
      >{{ p }}</span>
    </div>
    <UTooltip
      :text="projects.join(', ')"
      :disabled="projects.length <= shown.length"
    >
      <div class="flex gap-1.5 overflow-hidden">
        <span
          v-for="p in shown"
          :key="p"
          class="k-code min-w-0 truncate text-2xs"
        >{{ p }}</span>
        <span
          v-if="projects.length > shown.length"
          class="k-code flex-none text-2xs"
        >+{{ projects.length - shown.length }}</span>
        <span
          v-if="!projects.length"
          class="text-xs text-dimmed"
        >No projects</span>
      </div>
    </UTooltip>
  </div>
</template>
