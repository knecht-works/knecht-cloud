<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

// Renders one configured trigger (source → event → fired workflow → projects),
// with its active toggle and a menu to run it now or delete it. The page owns the
// API calls — this only emits intent.
interface Trigger {
  id: number
  source: 'github' | 'jira' | 'schedule' | 'manual'
  event: string
  kind: string
  workflow: string
  projects: string[]
  endpoint: string | null
  active: boolean
  lastFiredAt: number | null
  firedCount: number
}

const props = defineProps<{ trigger: Trigger }>()
const emit = defineEmits<{ toggle: [], run: [], remove: [] }>()

const SOURCE = {
  jira: { icon: 'i-lucide-zap', label: 'Jira', color: 'var(--accent-violet)' },
  github: { icon: 'i-simple-icons-github', label: 'GitHub', color: 'var(--text-toned)' },
  schedule: { icon: 'i-lucide-clock', label: 'Schedule', color: 'var(--accent-orange)' },
  manual: { icon: 'i-lucide-play', label: 'Manual', color: 'var(--text-primary)' },
}

const s = computed(() => SOURCE[props.trigger.source])

const menu = computed<DropdownMenuItem[][]>(() => [[
  { label: 'Run now', icon: 'i-lucide-play', onSelect: () => emit('run') },
  { label: props.trigger.active ? 'Pause' : 'Activate', icon: props.trigger.active ? 'i-lucide-pause' : 'i-lucide-play', onSelect: () => emit('toggle') },
  { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('remove') },
]])

function copyEndpoint() {
  if (props.trigger.endpoint) navigator.clipboard?.writeText(props.trigger.endpoint)
}
</script>

<template>
  <div
    class="k-card overflow-hidden"
    :style="{ opacity: trigger.active ? 1 : 0.62 }"
  >
    <!-- source identity + toggle -->
    <div class="flex items-center gap-3 px-[18px] pb-3.5 pt-4">
      <KStepIcon
        :icon="s.icon"
        :color="s.color"
        :size="38"
        :radius="9"
      />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="whitespace-nowrap text-[14.5px] font-medium text-(--text-highlighted)">{{ s.label }}</span>
          <span class="k-mono rounded-full border border-(--border-default) px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.08em] text-(--text-dimmed)">{{ trigger.kind }}</span>
        </div>
        <div class="mt-1 truncate text-[12.5px] text-(--text-muted)">
          {{ trigger.event }}
        </div>
      </div>
      <button
        type="button"
        :aria-label="trigger.active ? 'Pause trigger' : 'Activate trigger'"
        class="relative h-[19px] w-[34px] flex-none cursor-pointer rounded-full border border-(--border-default) transition-colors"
        :style="{ background: trigger.active ? 'var(--primary)' : 'var(--surface-accented)' }"
        @click="emit('toggle')"
      >
        <span
          class="absolute top-0.5 size-[13px] rounded-full transition-all"
          :style="{ left: trigger.active ? '17px' : '2px', background: trigger.active ? 'var(--accent-ink)' : 'var(--text-dimmed)' }"
        />
      </button>
      <UDropdownMenu
        :items="menu"
        :content="{ side: 'bottom', align: 'end' }"
      >
        <UButton
          icon="i-lucide-ellipsis-vertical"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Trigger actions"
        />
      </UDropdownMenu>
    </div>

    <!-- fires workflow -->
    <div class="mx-[18px] flex items-center gap-3 rounded-(--radius-md) border border-(--border-default) bg-(--surface-base) px-3.5 py-3">
      <span class="flex flex-none items-center gap-1 text-(--text-dimmed)">
        <UIcon
          name="i-lucide-arrow-right"
          class="size-3.5"
        />
        <UIcon
          name="i-lucide-workflow"
          class="size-[15px] text-(--text-primary)"
        />
      </span>
      <div class="min-w-0 flex-1">
        <div class="k-label !text-[9.5px]">
          Fires workflow
        </div>
        <span class="block truncate text-[13px] text-(--text-toned)">{{ trigger.workflow }}</span>
      </div>
      <div class="flex flex-none gap-1.5">
        <span
          v-for="p in trigger.projects"
          :key="p"
          class="k-mono whitespace-nowrap rounded-[5px] border border-(--border-muted) bg-(--surface-muted) px-2 py-1 text-[10px] text-(--text-muted)"
        >{{ p }}</span>
      </div>
    </div>

    <!-- endpoint -->
    <div class="px-[18px] pt-3">
      <div
        v-if="trigger.endpoint"
        class="flex items-center gap-2 text-(--text-dimmed)"
      >
        <UIcon
          :name="trigger.source === 'schedule' ? 'i-lucide-clock' : 'i-lucide-globe'"
          class="size-[13px] flex-none"
        />
        <span class="k-mono flex-1 truncate text-[11.5px] text-(--text-muted)">{{ trigger.endpoint }}</span>
        <button
          v-if="trigger.source !== 'schedule'"
          type="button"
          class="k-mono flex-none cursor-pointer rounded-[5px] border border-(--border-default) px-2 py-0.5 text-[10.5px] text-(--text-dimmed) transition-colors hover:text-(--text-muted)"
          @click="copyEndpoint"
        >
          copy
        </button>
      </div>
      <div
        v-else
        class="flex items-center gap-2 text-(--text-dimmed)"
      >
        <UIcon
          name="i-lucide-play"
          class="size-[13px]"
        />
        <span class="k-mono text-[11.5px] text-(--text-dimmed)">Started manually · no endpoint</span>
      </div>
    </div>

    <!-- footer -->
    <div class="mt-3 flex items-center justify-between border-t border-(--border-muted) px-[18px] pb-4 pt-3.5">
      <span class="flex items-center gap-1.5">
        <KStatusDot
          :color="trigger.active ? 'primary' : 'neutral'"
          :size="5"
        />
        <span class="k-mono text-[11px] text-(--text-dimmed)">Last {{ timeAgo(trigger.lastFiredAt) || 'never' }}</span>
      </span>
      <span class="k-mono text-[11px] text-(--text-muted)"><span class="font-semibold text-(--text-toned)">{{ trigger.firedCount }}</span> fires</span>
    </div>
  </div>
</template>
