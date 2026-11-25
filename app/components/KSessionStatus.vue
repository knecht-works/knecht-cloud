<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { runStatusMeta, sessionStatusLine, DOT_COLOR_VAR } from '~/utils/dashboard'
import KStatusBadge from '~/components/KStatusBadge.vue'
import { UIcon, UButton } from '#components'

type StatusRun = NonNullable<Parameters<typeof sessionStatusLine>[0]> & { workflowId: number | null }

const props = defineProps<{ run: StatusRun | null }>()

const statusMeta = computed(() => runStatusMeta(props.run))
const statusColor = computed(() => DOT_COLOR_VAR[statusMeta.value.dot])
const diagnosis = computed(() => props.run?.status === 'failed' ? props.run.failureDiagnosis : null)

// The mascot is as tall as the text. CSS cannot do it: an image's width cannot follow a height its own row stretches it to.
const text = useTemplateRef<HTMLElement>('text')
const textHeight = ref(0)
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    textHeight.value = entry!.contentRect.height
  })
  observer.observe(text.value!)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div
    class="k-card overflow-hidden"
    :style="{ borderColor: `color-mix(in oklab, ${statusColor} 30%, transparent)` }"
  >
    <div
      class="flex items-center gap-6 px-5 py-4.5"
      :style="{ background: `linear-gradient(90deg, color-mix(in oklab, ${statusColor} 8%, transparent), transparent)` }"
    >
      <img
        src="/mascot/mascotRight.png"
        alt="Knecht"
        class="min-h-13 w-auto flex-none drop-shadow-mascot"
        :style="{ height: `${textHeight}px` }"
      >
      <div
        ref="text"
        class="min-w-0"
      >
        <KStatusBadge
          class="w-fit"
          :meta="statusMeta"
        />
        <p class="mt-2 max-w-[80ch] text-sm leading-relaxed text-toned">
          <UIcon
            v-if="diagnosis?.state === 'pending'"
            name="i-lucide-loader-circle"
            class="mr-1 inline-block size-3 animate-spin motion-reduce:animate-none align-[-1px] text-dimmed"
          />{{ sessionStatusLine(run) }}
        </p>
        <div
          v-if="diagnosis?.state === 'done' && diagnosis.steps.length && run?.workflowId"
          class="mt-3 flex flex-wrap gap-1.5"
        >
          <UButton
            v-for="s in diagnosis.steps"
            :key="s.id"
            :to="{ path: `/workflows/${run.workflowId}`, query: { step: s.stepId } }"
            :label="`Open step ${s.label}`"
            color="neutral"
            variant="outline"
          />
        </div>
      </div>
    </div>
  </div>
</template>
