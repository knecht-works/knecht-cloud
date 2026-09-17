<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

type TimeValue = string | number | Date | null | undefined

interface Run {
  id: number
  status: RunStatus
  workflow: string
  projectId: number
  project: string
  startedAt: TimeValue
  finishedAt: TimeValue
  createdAt: TimeValue
}

defineProps<{
  groups: SessionGroup<Run>[]
  runTo: (run: Run) => RouteLocationRaw
  replace?: boolean
  selectedRunId?: number | null
  showProject?: boolean
}>()
</script>

<template>
  <div
    v-for="(g, gi) in groups"
    :key="g.sessionId"
    :class="[gi ? 'border-t border-muted' : '', g.object ? 'pb-1.5' : '']"
  >
    <KSessionGroupHeader
      v-if="g.object"
      :object="g.object"
      :project="showProject ? { id: g.runs[0]!.projectId, name: g.runs[0]!.project } : undefined"
    />
    <NuxtLink
      v-for="r in g.runs"
      :key="r.id"
      :to="runTo(r)"
      :replace="replace"
      class="relative flex items-center gap-3 pr-4.5 transition-colors hover:bg-(--surface-glass)"
      :class="[
        g.object ? 'py-1.5 pl-10.5' : 'py-3 pl-4.5',
        r.id === selectedRunId ? 'bg-(--surface-glass)' : '',
      ]"
      :aria-current="r.id === selectedRunId ? 'true' : undefined"
    >
      <span
        v-if="r.id === selectedRunId"
        class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
      />
      <KStatusDot
        :color="RUN_STATUS_META[r.status].dot"
        :pulse="RUN_STATUS_META[r.status].pulse"
        :size="6"
      />
      <span
        class="k-mono min-w-0 truncate"
        :class="g.object ? 'text-2xs text-muted' : 'text-xs text-default'"
      >{{ r.workflow }}</span>
      <span class="k-mono shrink-0 text-2xs text-dimmed">#{{ r.id }}</span>
      <span
        v-if="showProject && !g.object"
        class="k-mono hidden min-w-0 truncate text-2xs text-muted md:block"
      >{{ r.project }}</span>
      <span class="k-mono ml-auto w-14 flex-none text-right text-2xs text-dimmed">{{ runDuration(r.startedAt, r.finishedAt) }}</span>
      <span class="k-mono hidden w-16 flex-none text-right text-2xs text-dimmed sm:block">{{ timeAgo(r.createdAt) }}</span>
    </NuxtLink>
  </div>
</template>
