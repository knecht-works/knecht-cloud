<script setup lang="ts">
const config = defineModel<Record<string, unknown>>('config', { required: true })
const valid = defineModel<boolean>('valid', { default: false })

const CRON_PRESETS = [
  { label: 'Every 15 min', cron: '*/15 * * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily · 09:00', cron: '0 9 * * *' },
  { label: 'Weekdays · 09:00', cron: '0 9 * * 1-5' },
  { label: 'Weekly · Mon 09:00', cron: '0 9 * * 1' },
]

const cron = ref(typeof config.value.cron === 'string' ? config.value.cron : '0 9 * * *')
const cronLooksValid = computed(() => cron.value.trim().split(/\s+/).length === 5)

watch(cron, () => {
  config.value = { cron: cron.value.trim() }
  valid.value = cronLooksValid.value
}, { immediate: true })
</script>

<template>
  <div>
    <span class="k-label">Schedule</span>
    <UInput
      v-model="cron"
      placeholder="0 9 * * *"
      class="mt-2 w-full"
      :ui="{ base: 'k-mono' }"
    />
    <div class="mt-2 flex flex-wrap gap-1.5">
      <button
        v-for="p in CRON_PRESETS"
        :key="p.cron"
        type="button"
        class="k-mono cursor-pointer rounded-full border px-2.5 py-1 text-2xs transition-colors"
        :class="cron.trim() === p.cron
          ? 'border-(--primary-border) bg-(--lime-950) text-primary'
          : 'border-default text-dimmed hover:text-muted'"
        @click="cron = p.cron"
      >
        {{ p.label }}
      </button>
    </div>
    <p
      v-if="!cronLooksValid"
      class="mt-2 text-2xs text-error"
    >
      A cron expression has 5 fields: minute hour day month weekday.
    </p>
  </div>
</template>
