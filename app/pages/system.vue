<script setup lang="ts">
import { GC_AUTO_CATEGORIES, GC_CATEGORIES, type GcCategory } from '#shared/utils/gc'
import { useToast, $fetch } from '#imports'
import { useToastError } from '~/composables/useToastError'
import { ref } from 'vue'
import { formatBytes } from '#shared/utils/bytes'
import KTopBar from '~/components/KTopBar.vue'
import KSystemPanel from '~/components/KSystemPanel.vue'
import KPanel from '~/components/KPanel.vue'
import { UCheckbox, UButton } from '#components'

const toast = useToast()
const toastError = useToastError()

interface GcResult { total: number, freedBytes: number }
const selected = ref<GcCategory[]>([...GC_AUTO_CATEGORIES])
const runningGc = ref(false)

function toggle(id: GcCategory, checked: boolean) {
  selected.value = checked ? [...selected.value, id] : selected.value.filter(c => c !== id)
}

async function runGc() {
  runningGc.value = true
  try {
    const { total, freedBytes } = await $fetch<GcResult>('/api/gc', { method: 'POST', body: { categories: selected.value } })
    toast.add({
      title: total ? `Cleaned up ${total} item${total === 1 ? '' : 's'}` : 'Nothing to clean up',
      description: freedBytes ? `${formatBytes(freedBytes)} of disk space freed` : undefined,
      color: 'success',
    })
  }
  catch (e) {
    toastError('Cleanup failed', e)
  }
  finally {
    runningGc.value = false
  }
}
</script>

<template>
  <div>
    <KTopBar
      title="System"
      sub="Host daemon, sandbox runtime and running containers."
    />

    <KSystemPanel />

    <KPanel
      title="Cleanup"
      icon="i-lucide-trash-2"
      accent="var(--primary)"
      class="mt-4.5"
    >
      <p class="max-w-2xl text-2sm leading-relaxed text-muted">
        Pick what to clean up. Everything except the Knecht cache is also cleaned automatically every hour.
      </p>
      <div class="mt-4 flex flex-col gap-3">
        <UCheckbox
          v-for="category in GC_CATEGORIES"
          :key="category.id"
          :model-value="selected.includes(category.id)"
          :label="category.label"
          :description="category.hint"
          :disabled="runningGc"
          @update:model-value="toggle(category.id, $event === true)"
        />
      </div>
      <UButton
        size="lg"
        color="neutral"
        variant="outline"
        :label="selected.length ? `Clean up ${selected.length} selected` : 'Clean up'"
        :loading="runningGc"
        :disabled="!selected.length"
        class="mt-5"
        @click="runGc"
      />
    </KPanel>
  </div>
</template>
