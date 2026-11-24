<script setup lang="ts">
import { computed } from 'vue'
import { runStatusMeta, sessionStatusLine, DOT_COLOR_VAR } from '~/utils/dashboard'
import KStatusDot from '~/components/KStatusDot.vue'
import { UIcon, NuxtLink } from '#components'

type StatusRun = NonNullable<Parameters<typeof sessionStatusLine>[0]> & { workflowId: number | null }

const props = defineProps<{ run: StatusRun | null }>()

const statusMeta = computed(() => runStatusMeta(props.run))
const statusColor = computed(() => DOT_COLOR_VAR[statusMeta.value.dot])
const diagnosis = computed(() => props.run?.status === 'failed' ? props.run.failureDiagnosis : null)
</script>

<template>
  <div
    class="k-card overflow-hidden"
    :style="{ borderColor: `color-mix(in oklab, ${statusColor} 30%, transparent)` }"
  >
    <div
      class="flex items-center gap-3.5 px-5 py-4.5"
      :style="{ background: `linear-gradient(90deg, color-mix(in oklab, ${statusColor} 8%, transparent), transparent)` }"
    >
      <img
        src="/mascot/mascotRight.png"
        alt="Knecht"
        class="h-13 w-auto flex-none drop-shadow-mascot"
      >
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <KStatusDot
            :color="statusMeta.dot"
            :pulse="statusMeta.pulse"
            :size="6"
          />
          <span
            class="text-2xs uppercase tracking-widest"
            :style="{ color: statusMeta.text }"
          >{{ statusMeta.label }}</span>
        </div>
        <p class="mt-1.5 text-2sm leading-snug text-toned">
          <UIcon
            v-if="diagnosis?.state === 'pending'"
            name="i-lucide-loader-circle"
            class="mr-1 inline-block size-3 animate-spin motion-reduce:animate-none align-[-1px] text-dimmed"
          />{{ sessionStatusLine(run) }}
        </p>
        <div
          v-if="diagnosis?.state === 'done' && diagnosis.steps.length && run?.workflowId"
          class="mt-2 flex flex-wrap gap-1.5"
        >
          <NuxtLink
            v-for="s in diagnosis.steps"
            :key="s.id"
            :to="{ path: `/workflows/${run.workflowId}`, query: { step: s.stepId } }"
            class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-muted px-1.5 py-0.5 text-2xs text-muted transition-colors hover:bg-elevated/50 hover:text-highlighted"
          >
            <UIcon
              name="i-lucide-corner-down-right"
              class="size-3"
            />{{ s.label }}
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
