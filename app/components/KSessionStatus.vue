<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { sessionStatusLine } from '~/utils/dashboard'
import { UIcon, UButton } from '#components'

type StatusRun = NonNullable<Parameters<typeof sessionStatusLine>[0]> & { workflowId: number | null }

const props = defineProps<{ run: StatusRun | null }>()

const failed = computed(() => props.run?.status === 'failed')
const diagnosis = computed(() => failed.value ? props.run!.failureDiagnosis : null)

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
    :class="failed && 'border-(--status-error)/30'"
  >
    <div
      v-if="failed"
      class="flex items-center gap-2.5 border-b border-(--status-error)/25 bg-(--status-error)/10 px-5 py-2.5 text-sm font-medium text-(--status-error)"
    >
      <UIcon
        name="i-lucide-triangle-alert"
        class="size-4 flex-none"
      />
      Run failed
    </div>
    <div class="flex items-center gap-6 px-5 py-4.5">
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
        <p class="max-w-[80ch] text-sm leading-relaxed text-toned">
          <UIcon
            v-if="diagnosis?.state === 'pending'"
            name="i-lucide-loader-circle"
            class="mr-1 inline-block size-3 animate-spin motion-reduce:animate-none align-[-1px] text-dimmed"
          />{{ sessionStatusLine(run) }}
        </p>
      </div>
      <div
        v-if="diagnosis?.state === 'done' && diagnosis.steps.length && run?.workflowId"
        class="ml-auto flex flex-none flex-col items-end gap-1.5"
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
</template>
