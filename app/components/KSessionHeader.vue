<script setup lang="ts">
import type { RunStatusMeta, SessionGroup, SessionHeaderRun } from '~/utils/dashboard'
import { computed } from 'vue'
import { sessionTitle, sessionObjectMeta } from '~/utils/dashboard'
import { integrationUi } from '~/utils/integrations'
import KStatusBadge from '~/components/KStatusBadge.vue'
import { UIcon, UTooltip } from '#components'

const props = defineProps<{
  group: SessionGroup<SessionHeaderRun>
  status: RunStatusMeta
}>()

const title = computed(() => sessionTitle(props.group))
const objects = computed(() => props.group.objects
  .filter(o => o.url && o.kind !== 'pull_request')
  .map(o => ({ ...o, meta: sessionObjectMeta(o.integration, o.kind), source: integrationUi(o.integration).label })))
</script>

<template>
  <div class="flex items-center gap-4">
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <KStatusBadge
        :meta="status"
        size="md"
        class="mr-1.5"
      />
      <h2 class="truncate text-xl font-semibold tracking-tight text-highlighted">
        {{ title }}
      </h2>
      <UTooltip
        v-for="o in objects"
        :key="`${o.integration}:${o.kind}:${o.key}`"
        :text="`Open ${o.source} ${o.meta.label}`"
      >
        <a
          :href="o.url!"
          target="_blank"
          rel="noopener"
          class="ml-1.5 flex flex-none items-center gap-1.5 text-sm text-muted transition-colors hover:text-highlighted"
        >
          <UIcon
            :name="o.meta.icon"
            class="size-3.5"
            :style="{ color: o.closed ? 'var(--text-dimmed)' : o.meta.color }"
          />
          {{ o.meta.prefix }}{{ o.key }}
        </a>
      </UTooltip>
    </div>
    <div class="flex flex-none items-center">
      <slot />
    </div>
  </div>
</template>
