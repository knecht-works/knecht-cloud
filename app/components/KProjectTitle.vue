<script setup lang="ts">
const props = defineProps<{
  fullName: string
  private: boolean
  framework?: string | null
  frameworkVersion?: string | null
  favicon?: string | null
}>()

const parts = computed(() => {
  const [org, ...rest] = props.fullName.split('/')
  return { org, name: rest.join('/') || org }
})

const fw = computed(() => frameworkMeta(props.framework))
const fwLabel = computed(() => props.frameworkVersion ? `${fw.value.label} ${props.frameworkVersion}` : fw.value.label)
</script>

<template>
  <div class="flex min-w-0 items-center gap-3">
    <span
      v-if="favicon"
      class="grid size-9 flex-none place-items-center rounded-lg border border-default bg-(--surface-accented)"
    >
      <img
        :src="favicon"
        alt=""
        class="size-5 object-contain"
      >
    </span>
    <KStepIcon
      v-else
      icon="i-lucide-box"
      :color="fw.color"
      :size="36"
      :radius="9"
    />
    <div class="min-w-0">
      <div class="flex items-center gap-1.5 text-[15px] font-medium leading-tight text-highlighted">
        <UIcon
          v-if="private"
          name="i-lucide-lock"
          class="size-3 flex-none text-dimmed"
        />
        <span class="truncate">{{ parts.name }}</span>
      </div>
      <div class="mt-1 truncate text-xs text-muted">
        {{ parts.org }} · {{ fwLabel }}
      </div>
    </div>
  </div>
</template>
